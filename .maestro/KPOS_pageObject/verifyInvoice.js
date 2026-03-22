// ============ BƯỚC 1: GỌI API LOGIN ĐỂ LẤY BEARER TOKEN ============
console.log("=============== GỌI API LOGIN LẤY TOKEN ===============");

var loginResponse = http.request("https://api-dev.kingfoodmart.net/v1/users/login", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    "account": "SC003668",
    "password": "123645"
  })
});

console.log("[LOGIN] HTTP status: " + loginResponse.status);

if (loginResponse.status !== 200) {
  throw new Error("[FAIL] Đăng nhập API thất bại! status=" + loginResponse.status + " | body=" + loginResponse.body);
}

var loginData = json(loginResponse.body);
var token = loginData.jwt
  || (loginData.data && loginData.data.jwt)
  || (loginData.data && loginData.data.token)
  || loginData.token
  || loginData.access_token
  || "";

if (!token) {
  throw new Error("[FAIL] Không lấy được Bearer token! Response: " + loginResponse.body);
}
console.log("[LOGIN] ✅ Lấy token thành công.");

var authHeader = "Bearer " + token;

// ============ BƯỚC 2: LẤY INVOICE ID ============
// ============ BƯỚC 2: LẤY INVOICE ID ============
// Ưu tiên cao nhất: Lấy trực tiếp từ mã copy được ở Login_flow thông qua biến toàn cục maestro.copiedText
var invoiceId = "";
var rawCopiedText = typeof maestro !== "undefined" && maestro.copiedText ? maestro.copiedText : "";
var hexMatch = rawCopiedText.match(/[a-fA-F0-9]{24}/);

if (hexMatch) {
    invoiceId = hexMatch[0];
    console.log("[CHECK] ✅ Lấy ĐÚNG invoiceID hợp lệ từ maestro.copiedText: " + invoiceId);
} else {
    // Nếu không lấy được, thử lấy từ env
    invoiceId = (typeof env !== "undefined" && env.InvoiceID) || "";
    if (invoiceId && /^[a-f0-9]{24}$/i.test(invoiceId)) {
        console.log("[CHECK] ✅ Lấy ĐÚNG invoiceID hợp lệ từ env.InvoiceID: " + invoiceId);
    } else {
        console.log("[CHECK] ❌ KHÔNG lấy được invoiceID hợp lệ từ Login_flow. Giá trị hiện tại từ env: '" + invoiceId + "'");
        console.log("[CHECK] maestro.copiedText hiện tại: '" + rawCopiedText + "'");
    }
}
console.log("-----------------------------------------------------");

// Validate: InvoiceID phải là MongoDB ObjectID (24 ký tự hex)
// Nếu là literal string "${output.InvoiceID}" hoặc rỗng → dùng list API
if (invoiceId && !/^[a-f0-9]{24}$/i.test(invoiceId)) {
  console.log("[INVOICE ID] Giá trị không hợp lệ: '" + invoiceId + "' → bỏ qua, dùng list API");
  invoiceId = "";
}

if (!invoiceId) {
  console.log("[INVOICE ID] Không có InvoiceID hợp lệ từ env → gọi API lấy invoice mới nhất...");

  var listResponse = http.request(
    "https://api-dev.kingfoodmart.net/v1/sale-invoices?limit=1&sort=-updated_at",
    {
      method: "GET",
      headers: {
        "accept": "application/json, text/plain, */*",
        "authorization": authHeader,
        "cache-control": "no-cache"
      }
    }
  );

  console.log("[INVOICE LIST] HTTP status: " + listResponse.status);
  console.log("[INVOICE LIST] Body: " + listResponse.body);

  if (listResponse.status !== 200) {
    throw new Error("[FAIL] Gọi API list invoice thất bại! status=" + listResponse.status);
  }

  var listData = json(listResponse.body);
  var invoiceList = listData.items || listData.data || listData.sale_invoices || [];
  console.log("[INVOICE LIST] Số invoice: " + (Array.isArray(invoiceList) ? invoiceList.length : "không phải array"));

  if (Array.isArray(invoiceList) && invoiceList.length > 0) {
    invoiceId = invoiceList[0]._id || invoiceList[0].id || "";
  }

  console.log("[INVOICE ID] Lấy từ API list: " + invoiceId);
}

if (!invoiceId) {
  throw new Error("[FAIL] Không lấy được InvoiceID! Kiểm tra lại API list invoice hoặc truyền InvoiceID qua env.");
}

console.log("[INVOICE ID] ✅ Sử dụng InvoiceID = " + invoiceId);

// ============ BƯỚC 3: GỌI API VERIFY HOÁ ĐƠN (CÓ RETRY) ============
var url = "https://api-dev.kingfoodmart.net/v1/sale-invoices/" + invoiceId
  + "?includes=so_payments&is_get_promotion_notes=true";

console.log("=============== GỌI API VERIFY HOÁ ĐƠN ===============");
console.log("[INVOICE] InvoiceID dùng để gọi API: " + invoiceId);
console.log("[INVOICE] URL: " + url);

var response = null;
var maxRetries = 5;
var retryDelayMs = 5000;

for (var attempt = 1; attempt <= maxRetries; attempt++) {
  console.log("[INVOICE] >>> Lần gọi thứ " + attempt + "/" + maxRetries + " ...");

  response = http.request(url, {
    method: "GET",
    headers: {
      "accept": "application/json, text/plain, */*",
      "accept-language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
      "authorization": authHeader,
      "cache-control": "no-cache",
      "origin": "https://kdb-dev.kingfoodmart.net",
      "pragma": "no-cache",
      "referer": "https://kdb-dev.kingfoodmart.net/",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });

  console.log("[INVOICE] Lần " + attempt + " - HTTP status: " + response.status);

  if (response.status === 200) {
    console.log("[INVOICE] ✅ Gọi API thành công ở lần " + attempt);
    break;
  }

  if (response.status === 500 && attempt < maxRetries) {
    console.log("[RETRY] API trả về 500! body=" + response.body);
    console.log("[RETRY] Chờ 5 giây trước khi thử lại...");
    try {
      java.lang.Thread.sleep(retryDelayMs);
    } catch (e) {
      // Fallback busy-wait nếu java.lang.Thread không khả dụng
      var waitEnd = Date.now() + retryDelayMs;
      while (Date.now() < waitEnd) {}
    }
    console.log("[RETRY] Đã chờ xong, thử lại...");
  }
}

if (response.status !== 200) {
  throw new Error("[FAIL] Gọi API hóa đơn thất bại sau " + maxRetries + " lần thử! invoiceId=" + invoiceId + " | status=" + response.status + " | body=" + response.body);
}

console.log("[INVOICE] Body: " + response.body);

// ============ BƯỚC 4: VERIFY DỮ LIỆU ============
var data = json(response.body);
var items = data.invoice_details || data.order_items || data.items || [];

console.log("-----------------------------------------------------");
console.log("=============== DEBUG BIẾN MÔI TRƯỜNG ===============");
console.log("env variables passed to JS: " + (typeof env !== 'undefined' ? JSON.stringify(env) : "undefined"));
console.log("-----------------------------------------------------");

console.log("-----------------------------------------------------");
console.log("=============== KẾT QUẢ TỪ API ===============");
console.log(JSON.stringify(items, null, 2));
console.log("-----------------------------------------------------");

console.log("[VERIFY] Số line items từ API: " + items.length);

// 1. Tongsoluong: tổng tất cả quantity
var totalQty = 0;
for (var i = 0; i < items.length; i++) {
  totalQty += (items[i].quantity || 0);
}

// Cập nhật cách đọc biến: Trong JS chạy bằng Maestro, các thư mục tham số từ YAML 
// được đưa thẳng vào làm biến cục bộ thay vì nhét trong object `env`.
var expectedQtyRaw = (typeof Tongsoluong !== 'undefined' ? Tongsoluong : undefined);
var expectedQty = parseInt(expectedQtyRaw || "0");
console.log("[VERIFY] Tổng số lượng: actual=" + totalQty + " | expected=" + expectedQty);
if (totalQty !== expectedQty) {
  var dumpVars = "Tongsoluong=" + (typeof Tongsoluong !== 'undefined' ? Tongsoluong : "undefined");
  throw new Error("[FAIL] Tổng số lượng không khớp! actual=" + totalQty + " | expected=" + expectedQty + " | rawVars=[" + dumpVars + "]");
}

// 2. Giamgia: invoice_discount hoặc discount_total
var discountRaw = data.invoice_discount !== undefined ? data.invoice_discount : (data.discount_total || 0);
var expectedDiscount = (typeof Giamgia !== 'undefined' && Giamgia !== null) ? String(Giamgia) : "0";
var normalizedDiscount = expectedDiscount.replace(/[.]/g, "");
console.log("[VERIFY] Giảm giá: actual=" + discountRaw + " | expected=" + normalizedDiscount);
if (String(discountRaw) !== normalizedDiscount) {
  var dumpVars = "Giamgia=" + (typeof Giamgia !== 'undefined' ? Giamgia : "undefined");
  throw new Error("[FAIL] Giảm giá không khớp! actual=" + discountRaw + " | expected=" + normalizedDiscount + " | rawVars=[" + dumpVars + "]");
}

// 3. Khachcantra: total_payment hoặc total_customer_pay
var totalPay = data.total_payment !== undefined ? data.total_payment : (data.total_customer_pay || 0);
var totalPayFormatted = totalPay.toLocaleString("vi-VN").replace(/\u00a0/g, ".").replace(/,/g, ".");
var expectedPay = (typeof Khachcantra !== 'undefined' && Khachcantra !== null) ? String(Khachcantra) : "0";
console.log("[VERIFY] Khách cần trả: actual=" + totalPayFormatted + " | expected=" + expectedPay);
if (totalPayFormatted !== expectedPay) {
  var dumpVars = "Khachcantra=" + (typeof Khachcantra !== 'undefined' ? Khachcantra : "undefined");
  throw new Error("[FAIL] Khách cần trả không khớp! actual=" + totalPayFormatted + " | expected=" + expectedPay + " | rawVars=[" + dumpVars + "]");
}

// 4. Promo Text: promotion_notes
var expectedPromoRaw = (typeof PROMO_TEXT !== 'undefined' ? PROMO_TEXT : undefined);
if (expectedPromoRaw) {
  var actualPromoNotes = data.promotion_notes || "";
  var actualPromoNotesStr = typeof actualPromoNotes === 'string' ? actualPromoNotes : JSON.stringify(actualPromoNotes);
  console.log("[VERIFY] Promotion notes: actual=" + actualPromoNotesStr + " | expected=" + expectedPromoRaw);
  if (actualPromoNotesStr.indexOf(expectedPromoRaw) === -1) {
    var dumpVars = "PROMO_TEXT=" + expectedPromoRaw;
    throw new Error("[FAIL] Promotion notes không chứa text mong đợi! actual=" + actualPromoNotesStr + " | expected=" + expectedPromoRaw + " | rawVars=[" + dumpVars + "]");
  }
}

console.log("✅ [PASS] Tất cả verify hóa đơn đã PASSED!");
output.verifyData = response.body;
