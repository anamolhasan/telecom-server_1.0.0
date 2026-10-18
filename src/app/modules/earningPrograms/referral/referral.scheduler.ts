import { ReferralService } from "./referral.service";

const DEFAULT_RECONCILE_INTERVAL_MS = 24 * 60 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

const runReconciliation = async () => {
    try {
        const result = await ReferralService.reconcileAllReferralEligibility();
        console.log(
            `[referral-scheduler] reconciled ${result.evaluated} approved applicant(s); ${result.eligible} currently eligible`,
        );
    } catch (error) {
        console.error("[referral-scheduler] reconciliation failed:", error);
    }
};

// Reliable rolling 6-month reconciliation. Uses a dependency-free interval timer
// (no scheduler was present in the project) started from the server bootstrap.
// Re-runs immediately once so staleness cannot persist after deploy.
export const startReferralEligibilityScheduler = (
    intervalMs: number = DEFAULT_RECONCILE_INTERVAL_MS,
): ReturnType<typeof setInterval> => {
    if (timer) {
        return timer;
    }

    void runReconciliation();

    timer = setInterval(() => {
        void runReconciliation();
    }, intervalMs);

    timer.unref();

    return timer;
};

export const stopReferralEligibilityScheduler = () => {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
};