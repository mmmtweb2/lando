export interface PaymentResult {
  success: boolean;
  transactionId: string;
}

export async function processMockPayment(pageId: string, amount: number): Promise<PaymentResult> {
  console.log(`[PAYMENT] Mock charge — pageId:${pageId} amount:${amount}`);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const transactionId = `mock_${pageId}_${Date.now()}`;
  console.log(`[PAYMENT] Success — transactionId:${transactionId}`);
  return { success: true, transactionId };
}
