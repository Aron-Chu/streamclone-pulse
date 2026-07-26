import type { TourStep } from './types.ts'

export interface TourRailProps {
  steps: readonly TourStep[]
  activeStep: number
  id?: string
}

export function TourRail({ steps, activeStep, id }: TourRailProps) {
  return (
    <aside className="sl-xtour__rail" aria-labelledby={id}>
      <span className="sl-xtour__eyebrow">
        <span className="sl-dot" aria-hidden="true" /> StreamPulse · Pulse tab
      </span>
      <ol className="sl-xtour__steps">
        {steps.map((step, idx) => {
          const stepNumber = idx + 1
          const isActive = stepNumber === activeStep
          return (
            <li
              className="sl-xtour__step"
              data-step={stepNumber}
              key={step.kicker}
              aria-current={isActive ? 'step' : undefined}
            >
              <span className="sl-xtour__step-rail" aria-hidden="true" />
              <span className="sl-xtour__step-kicker">{step.kicker}</span>
              <span className="sl-xtour__step-title">{step.title}</span>
              <span className="sl-xtour__step-body">{step.body}</span>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
