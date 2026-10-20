import {
  GUIDE_KICKER,
  GUIDE_POINTS_BADGES,
  GUIDE_POINTS_LEAD,
  GUIDE_POINTS_LINK,
  GUIDE_POINTS_RELAYER,
  GUIDE_POINTS_TITLE,
  GUIDE_POINTS_YOURS,
  GUIDE_RESCUE_LEAD,
  GUIDE_RESCUE_TITLE,
  GUIDE_START_LABEL,
  GUIDE_STEP_1_BODY,
  GUIDE_STEP_1_TITLE,
  GUIDE_STEP_2_BODY,
  GUIDE_STEP_2_TITLE,
  GUIDE_STEP_3_BODY,
  GUIDE_STEP_3_TITLE,
  GUIDE_STEP_4_BODY,
  GUIDE_STEP_4_TITLE,
} from "./copy";
import { RESCUE_BADGES, rescueCountLabel } from "./lib/rescueBadges";

const STEPS = [
  { title: GUIDE_STEP_1_TITLE, body: GUIDE_STEP_1_BODY },
  { title: GUIDE_STEP_2_TITLE, body: GUIDE_STEP_2_BODY },
  { title: GUIDE_STEP_3_TITLE, body: GUIDE_STEP_3_BODY },
  { title: GUIDE_STEP_4_TITLE, body: GUIDE_STEP_4_BODY },
];

export function RescueGuide() {
  return (
    <section className="guide" id="how-it-works" data-testid="rescue-guide">
      <p className="guide-kicker">{GUIDE_KICKER}</p>
      <h2>{GUIDE_RESCUE_TITLE}</h2>
      <p className="guide-lead">{GUIDE_RESCUE_LEAD}</p>
      <ol className="guide-path">
        {STEPS.map((step, index) => (
          <li className="guide-step" data-testid="guide-step" key={step.title}>
            <span className="guide-step-num">{String(index + 1)}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </li>
        ))}
      </ol>
      <div className="guide-points">
        <h2>{GUIDE_POINTS_TITLE}</h2>
        <p>{GUIDE_POINTS_LEAD}</p>
        <ul className="guide-facts">
          <li>{GUIDE_POINTS_YOURS}</li>
          <li>{GUIDE_POINTS_RELAYER}</li>
        </ul>
        <p>{GUIDE_POINTS_BADGES}</p>
        <ul className="guide-badges">
          {RESCUE_BADGES.map((badge) => (
            <li className={"rescue-badge rescue-badge-" + badge.id} data-testid="guide-badge" key={badge.id}>
              <span className="rescue-mark" aria-hidden="true" />
              <span>{badge.name}</span>
              <span className="rescue-count">{rescueCountLabel(badge.minRescues)}</span>
            </li>
          ))}
        </ul>
        <div className="guide-actions">
          <a className="btn btn-primary" href="#rescue">
            {GUIDE_START_LABEL}
          </a>
          <a className="btn" href="/points">
            {GUIDE_POINTS_LINK}
          </a>
        </div>
      </div>
    </section>
  );
}
