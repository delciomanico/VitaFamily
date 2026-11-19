// Operações do contrato MK3 (commit e2eef2d) ainda sem implementação. Os testes de conformidade com o OpenAPI
// excluem-nas explicitamente; a fatia S13 esvazia esta lista (ao ser vazia, as garantias voltam a cobrir tudo).
export const MK3_PENDING_OPERATION_IDS: ReadonlySet<string> = new Set([
  "adminDecidePaymentDispute", "adminDecideReviewReport", "adminDownloadPaymentProof", "adminGetPaymentDispute",
  "adminGetReviewReport", "adminListPaymentDisputes", "adminListReviewReports",
  "decidePaymentProof",
  "disputePaymentProof", "downloadFamilyPaymentProof", "downloadProfessionalPaymentProof",
  "getFamilyBookingReview",
  "listFamilyPaymentProofs", "listProfessionalReviews", "listProfessionalReviewsOwn",
  "putFamilyBookingReview", "replyToReview", "reportReview", "uploadPaymentProof",
]);

// Todas as operações do contrato MK3 (31): os testes de conformidade de MK1/MK2 deixam-nas de fora (têm os seus testes, S13).
export const MK3_OPERATION_IDS: ReadonlySet<string> = new Set([
  "adminDecidePaymentDispute", "adminDecideReviewReport", "adminDownloadPaymentProof", "adminGetPaymentDispute",
  "adminGetReviewReport", "adminListPaymentDisputes", "adminListReviewReports", "cancelFamilyBooking",
  "cancelProfessionalBooking", "completeBooking", "confirmBooking", "createBooking", "decidePaymentProof",
  "disputePaymentProof", "downloadFamilyPaymentProof", "downloadProfessionalPaymentProof", "getFamilyBooking",
  "getFamilyBookingReview", "getProfessionalBooking", "listBookableSlots", "listFamilyBookings",
  "listFamilyPaymentProofs", "listProfessionalBookings", "listProfessionalReviews", "listProfessionalReviewsOwn",
  "markBookingNoShow", "putFamilyBookingReview", "rejectBooking", "replyToReview", "reportReview", "uploadPaymentProof",
]);
