/**
 * `conjecture probe <endpoint>`
 *
 * Connects to a Lean endpoint, runs one real check through it, and reports
 * exactly what came back. This exists because the machine that writes this code
 * and the machine that runs a Lean server are usually not the same machine, and
 * "it should work" is not a claim this project is allowed to make.
 */

import { isEngineError, RemoteLeanEngine } from '@conjecture/lean';

const PROBE_SOURCE = [
  'theorem conjecture_probe (n : Nat) : n + 0 = n := by',
  '  simp',
].join('\n');

const HOLE_SOURCE = [
  'theorem conjecture_probe_hole (n : Nat) : n + 0 = n := by',
  '  sorry',
].join('\n');

export interface ProbeReport {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

function tick(good: boolean): string {
  return good ? '  ok  ' : ' FAIL ';
}

export async function probeEndpoint(endpoint: string, project?: string): Promise<ProbeReport> {
  const lines: string[] = [];
  const engine = new RemoteLeanEngine({ endpoint, ...(project ? { project } : {}) });

  lines.push(`endpoint  ${engine.endpointUrl}`);
  lines.push('');

  const health = await engine.health();
  if (health.status !== 'ready') {
    lines.push(`${tick(false)} connect`);
    lines.push(`         ${health.status === 'unavailable' ? health.reason : health.detail}`);
    lines.push('');
    lines.push('Nothing else could be tried without a connection.');
    return { ok: false, lines };
  }
  lines.push(`${tick(true)} connect         ${health.detail}`);

  const pin = await engine.describePin();
  lines.push(`${tick(pin !== null)} toolchain       ${pin?.toolchain ?? 'not reported'}`);
  lines.push(
    `${tick(true)} library rev     not reported by this endpoint (expected; see the note below)`,
  );

  // A theorem that should close cleanly. This is the one that matters: it
  // exercises elaboration, the kernel, and #print axioms in one pass.
  const proved = await engine.elaborate({
    relativePath: 'Probe.lean',
    source: PROBE_SOURCE,
    declaration: 'conjecture_probe',
    maxHeartbeats: 200_000,
    timeoutMs: 120_000,
  });

  if (isEngineError(proved)) {
    lines.push(`${tick(false)} elaborate       ${proved.message}`);
    return { ok: false, lines };
  }

  const errors = proved.diagnostics.filter((d) => d.severity === 'error');
  lines.push(
    `${tick(errors.length === 0)} elaborate       ${
      errors.length === 0 ? `clean in ${proved.elapsedMs} ms` : errors[0]!.message.split('\n')[0]!
    }`,
  );

  const axiomsOk = proved.axioms !== null;
  lines.push(
    `${tick(axiomsOk)} #print axioms   ${
      axiomsOk
        ? proved.axioms!.axioms.map((a) => a.name).join(', ') || 'depends on no axioms'
        : 'no axiom report came back — receipts would be incomplete'
    }`,
  );

  // A file with a hole, to check the goal-state path.
  const withHole = await engine.elaborate({
    relativePath: 'ProbeHole.lean',
    source: HOLE_SOURCE,
    declaration: null,
    maxHeartbeats: 200_000,
    timeoutMs: 120_000,
  });

  const holeGoals = isEngineError(withHole) ? [] : withHole.goals;
  const goalsOk = holeGoals.length > 0;
  lines.push(
    `${tick(goalsOk)} goal at a hole  ${
      goalsOk ? holeGoals[0]!.goal : 'no goal returned — the panel will be empty at holes'
    }`,
  );

  const ok = errors.length === 0 && axiomsOk && pin !== null;

  lines.push('');
  if (ok) {
    lines.push('This endpoint can verify claims.');
  } else {
    lines.push('This endpoint answered, but not well enough to record receipts against.');
  }
  lines.push(
    'The library revision is not part of a remote pin, so a Mathlib bump on the',
  );
  lines.push('server will not mark existing results stale. That limit is reported in the app.');

  return { ok, lines };
}
