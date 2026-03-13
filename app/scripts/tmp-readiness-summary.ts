import { analyzeFromFile } from './debug-pipeline/analyze-trip';

const files = [
  '/Users/zak/voyage-planner/app/scripts/debug-pipeline/results/paris-rome-4d-2026-02-15T23-15-23.json',
  '/Users/zak/voyage-planner/app/scripts/debug-pipeline/results/1day-express-2026-02-15T23-16-59.json',
  '/Users/zak/voyage-planner/app/scripts/debug-pipeline/results/train-only-2026-02-15T23-18-30.json',
];

(async () => {
  const summaries: Array<Record<string, unknown>> = [];

  for (const file of files) {
    const report = await analyzeFromFile(file, { silent: true });
    const allIssues = Object.values(report.sections).flat();

    summaries.push({
      scenarioId: report.scenarioId,
      score: report.summary.score,
      critical: report.summary.critical,
      warning: report.summary.warning,
      info: report.summary.info,
      topRegressions: report.topRegressions.slice(0, 5).map((r) => `${r.component || r.category}:${r.code || r.key}`),
      topCritical: allIssues
        .filter((i) => i.severity === 'critical')
        .slice(0, 5)
        .map((i) => `${i.component || i.category}:${i.code || i.category}`),
    });
  }

  const avgScore = summaries.reduce((sum, s) => sum + Number(s.score || 0), 0) / summaries.length;
  const totalCritical = summaries.reduce((sum, s) => sum + Number(s.critical || 0), 0);

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    cases: summaries,
    aggregate: {
      avgScore,
      totalCritical,
      caseCount: summaries.length,
      productionReady: avgScore >= 85 && totalCritical === 0,
    },
  }, null, 2));
})();
