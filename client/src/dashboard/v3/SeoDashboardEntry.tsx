import { lazy, Suspense } from 'react';
import SeoDashboardV2 from '../SeoDashboardV2';
import { dashV3Enabled } from './flag';
import { OverviewSkeleton } from '../Overview';

// The one place that decides between the two dashboards: v2 stays the default, ?dash=v3 opts in.
// v3 is a separate chunk, so accounts that do not use it download nothing extra.
const SeoDashboardV3 = lazy(() => import('./SeoDashboardV3'));

export default function SeoDashboardEntry({ showPageUpsell = false }: { showPageUpsell?: boolean }) {
  if (!dashV3Enabled()) return <SeoDashboardV2 showPageUpsell={showPageUpsell} />;
  return (
    <Suspense fallback={<div className="dv2 rounded-[18px] p-3 sm:p-5" dir="rtl"><OverviewSkeleton /></div>}>
      <SeoDashboardV3 showPageUpsell={showPageUpsell} />
    </Suspense>
  );
}
