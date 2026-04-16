-- Single voucher invariant: voucherId replaces the old voucherIds array
DEFINE FIELD voucherId ON subscription TYPE option<record<voucher>>;
