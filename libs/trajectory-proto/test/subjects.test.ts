// The subject constants and functions of the package equal the subjects of
// the table in proto/README.md, the human documentation of the contract.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LAUNCHES_ACCEPTED,
  PIPELINE_ERRORS,
  SERVICE_NAMES,
  TRAJECTORIES_COMPUTED,
  TRAJECTORIES_STORED,
  configAppliedSubject,
  configSetSubject,
  statusSubject,
} from '@albertoriorda95/trajectory-proto';

const readme = readFileSync(new URL('../../../proto/README.md', import.meta.url), 'utf8');

// The rows of the table under "## NATS subjects": subject -> message.
function documentedSubjects(): Map<string, string> {
  const section = readme.split('## NATS subjects')[1]?.split('\n## ')[0] ?? '';
  const rows = new Map<string, string>();
  for (const line of section.split('\n')) {
    const match = /^\| `([^`]+)` \| `([^`]+)` \|/.exec(line);
    if (match?.[1] && match[2]) rows.set(match[1], match[2]);
  }
  return rows;
}

function documentedServiceNames(): string[] {
  // the sentence may wrap: read up to its full stop
  const sentence = /Service names on the subjects:([^.]*)\./.exec(readme)?.[1] ?? '';
  return [...sentence.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
}

describe('NATS subjects', () => {
  const documented = documentedSubjects();

  it('the README table lists the seven subjects', () => {
    expect([...documented.keys()].sort()).toEqual(
      [
        'config.<service>.applied',
        'config.<service>.set',
        'launches.accepted',
        'pipeline.errors',
        'status.<service>',
        'trajectories.computed',
        'trajectories.stored',
      ].sort(),
    );
  });

  it('the constants equal the fixed subjects of the README', () => {
    expect(documented.get(LAUNCHES_ACCEPTED)).toBe('trajectory.v1.LaunchAccepted');
    expect(documented.get(TRAJECTORIES_COMPUTED)).toBe('trajectory.v1.TrajectoryComputed');
    expect(documented.get(TRAJECTORIES_STORED)).toBe('trajectory.v1.TrajectoryStored');
    expect(documented.get(PIPELINE_ERRORS)).toBe('trajectory.v1.PipelineError');
  });

  it('the service names equal those of the README', () => {
    expect([...SERVICE_NAMES]).toEqual(documentedServiceNames());
  });

  it('the per-service functions follow the README patterns', () => {
    expect(statusSubject('store')).toBe('status.store');
    expect(configSetSubject('propagator')).toBe('config.propagator.set');
    expect(configAppliedSubject('ros2-publisher')).toBe('config.ros2-publisher.applied');
    for (const service of SERVICE_NAMES) {
      const expand = (pattern: string) => pattern.replace('<service>', service);
      expect(statusSubject(service)).toBe(expand('status.<service>'));
      expect(configSetSubject(service)).toBe(expand('config.<service>.set'));
      expect(configAppliedSubject(service)).toBe(expand('config.<service>.applied'));
    }
    expect(documented.get('status.<service>')).toBe('trajectory.v1.ServiceStatus');
    expect(documented.get('config.<service>.set')).toBe('trajectory.v1.ConfigSet');
    expect(documented.get('config.<service>.applied')).toBe('trajectory.v1.ConfigApplied');
  });
});
