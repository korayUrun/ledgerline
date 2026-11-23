import {
  PaymentRefusedError,
  type CreateTransferInput,
  type PaymentGateway,
} from "./payment-gateway.js";

// A PaymentGateway that never calls Stripe, for tests. It copies the one behaviour
// the payment code relies on: a repeated idempotency key returns the transfer that
// key already created, instead of making a second one. Tests count `transfers` to
// prove "paid exactly once".
export class FakePaymentGateway implements PaymentGateway {
  // One entry per real transfer, keyed by idempotency key.
  readonly transfers = new Map<string, CreateTransferInput & { transferId: string }>();
  readonly accounts: string[] = [];
  // Every createTransfer call, repeats included.
  calls = 0;

  // Scripted problems for the next call, used by the failure drills.
  private next: "refuse" | "timeout" | "crash_after_transfer" | null = null;

  // A clean Stripe for the next test: no transfers, no scripted problem left over.
  reset(): void {
    this.transfers.clear();
    this.accounts.length = 0;
    this.calls = 0;
    this.next = null;
  }

  refuseNext(): void {
    this.next = "refuse";
  }

  // No answer: the transfer was NOT made.
  timeOutNext(): void {
    this.next = "timeout";
  }

  // The transfer IS made, then the caller dies before it can save the answer
  // (Break it 1: the worker is killed right after the Stripe call).
  crashAfterNextTransfer(): void {
    this.next = "crash_after_transfer";
  }

  createTransfer(input: CreateTransferInput): Promise<{ transferId: string }> {
    this.calls += 1;
    const scripted = this.next;
    this.next = null;
    if (scripted === "refuse") {
      return Promise.reject(new PaymentRefusedError("Stripe: insufficient funds (fake)"));
    }
    if (scripted === "timeout") {
      return Promise.reject(new Error("Request timed out (fake)"));
    }

    const existing = this.transfers.get(input.idempotencyKey);
    const transfer = existing ?? { ...input, transferId: `tr_fake_${this.transfers.size + 1}` };
    this.transfers.set(input.idempotencyKey, transfer);
    if (scripted === "crash_after_transfer") {
      return Promise.reject(new Error("worker killed after the Stripe call (fake)"));
    }
    return Promise.resolve({ transferId: transfer.transferId });
  }

  createConnectedAccount(input: { artistId: string }): Promise<{ accountId: string }> {
    const accountId = `acct_fake_${input.artistId.slice(0, 8)}`;
    this.accounts.push(accountId);
    return Promise.resolve({ accountId });
  }

  createOnboardingLink(input: { accountId: string; returnUrl: string }): Promise<{ url: string }> {
    return Promise.resolve({
      url: `https://connect.stripe.test/onboarding/${input.accountId}?return=${encodeURIComponent(input.returnUrl)}`,
    });
  }
}
