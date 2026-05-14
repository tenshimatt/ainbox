/**
 * OnboardingStepper — numbered step indicator for the onboarding flow.
 * Displays "Step N of M" header and a row of step pills.
 * PRD: §TASKRESPONSE-53
 */

interface Step {
  label: string;
  href: string;
}

const ONBOARDING_STEPS: Step[] = [
  { label: 'Sync email',          href: '/onboarding/sync' },
  { label: 'Review knowledge base', href: '/onboarding/kb-review' },
];

interface Props {
  /** 1-based current step index */
  currentStep: number;
}

export function OnboardingStepper({ currentStep }: Props) {
  const total = ONBOARDING_STEPS.length;
  return (
    <div className="mb-8" data-testid="onboarding-stepper">
      {/* "Step N of M" header */}
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500" data-testid="onboarding-step-label">
        Step {currentStep} of {total}
      </p>

      {/* Step pills */}
      <div className="mt-3 flex items-center gap-2">
        {ONBOARDING_STEPS.map((step, idx) => {
          const stepNum = idx + 1;
          const isDone    = stepNum < currentStep;
          const isActive  = stepNum === currentStep;
          return (
            <div key={step.href} className="flex items-center gap-2">
              {/* Connector line (not before first) */}
              {idx > 0 && (
                <div
                  className={`h-px w-8 flex-shrink-0 ${isDone ? 'bg-green-400' : 'bg-slate-200'}`}
                  aria-hidden="true"
                />
              )}
              <div
                className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
                  isDone
                    ? 'bg-green-100 text-green-700'
                    : isActive
                    ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
                    : 'bg-slate-100 text-slate-400'
                }`}
                data-testid={`onboarding-step-${stepNum}`}
                aria-current={isActive ? 'step' : undefined}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                    isDone
                      ? 'bg-green-500 text-white'
                      : isActive
                      ? 'bg-blue-500 text-white'
                      : 'bg-slate-300 text-slate-500'
                  }`}
                >
                  {isDone ? '✓' : stepNum}
                </span>
                <span className="hidden sm:inline">{step.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
