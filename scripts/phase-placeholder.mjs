// Placeholder for root scripts whose implementation belongs to a later phase.
// It fails loudly on purpose: a placeholder must never look like a passing check.
const [script, phase] = process.argv.slice(2);
console.error(
  `${script ?? 'this script'} is not implemented yet; it arrives in Phase ${phase ?? '?'}.`,
);
process.exit(1);
