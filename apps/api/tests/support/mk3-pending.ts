// Operações do contrato MK3 (commit e2eef2d) ainda sem implementação. Os testes de conformidade com o OpenAPI
// excluem-nas explicitamente; a fatia S13 esvazia esta lista (ao ser vazia, as garantias voltam a cobrir tudo).
export const MK3_PENDING_OPERATION_IDS: ReadonlySet<string> = new Set([
  "adminDecidePaymentDispute", "adminDecideReviewReport", "adminDownloadPaymentProof", "adminGetPaymentDispute",
  "adminGetReviewReport", "adminListPaymentDisputes", "adminListReviewReports",
  "cancelProfessionalBooking", "completeBooking", "confirmBooking", "decidePaymentProof",
  "disputePaymentProof", "downloadFamilyPaymentProof", "downloadProfessionalPaymentProof",
  "getFamilyBookingReview", "getProfessionalBooking",
  "listFamilyPaymentProofs", "listProfessionalBookings", "listProfessionalReviews", "listProfessionalReviewsOwn",
  "markBookingNoShow", "putFamilyBookingReview", "rejectBooking", "replyToReview", "reportReview", "uploadPaymentProof",
]);
