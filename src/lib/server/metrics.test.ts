import { describe, expect, it } from 'vitest';
import { registry } from './metrics';

describe('metrics registry', () => {
	it('exposes default process metrics in Prometheus exposition format', async () => {
		const body = await registry.metrics();
		expect(body).toMatch(/^# HELP /m);
		expect(body).toMatch(/^# TYPE /m);
		expect(body).toContain('process_cpu_user_seconds_total');
	});

	it('reports the standard Prometheus text content type', () => {
		expect(registry.contentType).toBe('text/plain; version=0.0.4; charset=utf-8');
	});
});
