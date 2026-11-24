"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  currentStepIndex,
  SHOW_STEPS,
  stepComplete,
  type StepState,
} from "../../../lib/show-steps";
import { LockIcon } from "../../components";

// The four steps of a show as a stepper: where you are ("Step 2 of 4"), how far the
// show is (a track whose finished segments are filled), and each step's state in
// words. The states are worked out on the server (layout.tsx); this is a client
// component only because the current step comes from the URL (usePathname), the same
// way NavLink lights the sidebar.
export function ShowStepper({ showId, states }: { showId: string; states: StepState[] }) {
  const pathname = usePathname();
  const current = currentStepIndex(pathname, showId);
  const completeCount = states.filter(stepComplete).length;
  const currentStep = current === null ? undefined : SHOW_STEPS[current];

  return (
    <nav className="stepper" aria-label="Show steps">
      <div className="stepper-head">
        <p className="stepper-progress">
          {currentStep ? `Step ${currentStep.number} of ${SHOW_STEPS.length}` : "Steps"}
          <span aria-hidden="true"> · </span>
          <span className="visually-hidden">, </span>
          {completeCount} done
        </p>
        {/* On a phone the step cells drop their descriptions and connectors; the
            current step's description and this compact track stand in for them. */}
        {currentStep && <p className="stepper-current-desc">{currentStep.description}</p>}
        <div className="stepper-bar" aria-hidden="true">
          {states.map((state, index) => (
            <span key={index} className={stepComplete(state) ? "is-complete" : undefined} />
          ))}
        </div>
      </div>
      <ol className="stepper-steps">
        {SHOW_STEPS.map((step, index) => {
          const state = states[index];
          if (!state) return null;
          return (
            <li key={step.number} className={stepComplete(state) ? "is-complete" : undefined}>
              <Link
                href={`/shows/${showId}${step.path}`}
                aria-current={index === current ? "page" : undefined}
              >
                <StepMarker number={step.number} state={state} />
                <span className="step-text">
                  {/* Hidden words make the link read as a sentence: "Step 2: Contract,
                      Needs review. Upload the contract PDF…" */}
                  <span className="step-title">
                    <span className="visually-hidden">Step {step.number}: </span>
                    {step.title}
                    <span className="visually-hidden">, </span>
                  </span>
                  <span className={`step-state step-${state.tone}`}>{state.label}</span>
                  <span className="visually-hidden">. </span>
                  <span className="step-desc">{step.description}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// The round marker: the step's number while it is open, a tick when done, a padlock
// when locked, "!" when it needs attention. Decoration: the state label says the same.
function StepMarker({ number, state }: { number: number; state: StepState }) {
  let symbol: React.ReactNode = number;
  if (state.tone === "done") symbol = "✓";
  if (state.tone === "attention") symbol = "!";
  if (state.tone === "locked") symbol = <LockIcon />;
  return (
    <span className={`step-marker marker-${state.tone}`} aria-hidden="true">
      {symbol}
    </span>
  );
}
