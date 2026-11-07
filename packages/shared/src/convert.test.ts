import { describe, expect, it } from 'vitest';
import { StepSchema, isConvertJob } from './api.js';
import { videoCodecOf } from './media.js';
import { SettingsSchema, defaultSettings } from './settings.js';

describe('convert', () => {
  it('normalizes QuickTime compressor ids', () => {
    expect(videoCodecOf('avc1')).toBe('h264');
    expect(videoCodecOf('hvc1')).toBe('hevc');
    expect(videoCodecOf('hev1')).toBe('hevc');
    expect(videoCodecOf('dvh1')).toBe('hevc');
    expect(videoCodecOf('av01')).toBe('av1');
    expect(videoCodecOf('mp4v')).toBe('other');
    expect(videoCodecOf(undefined)).toBeUndefined();
  });

  it('has defaults, also for settings saved before the section existed', () => {
    expect(defaultSettings().convert).toEqual({ crf: 24, preset: 'medium', skipCodecs: ['hevc', 'av1'], minBitrateMbps: 10, minSavingPct: 20, jpegQuality: 90 });
    expect(SettingsSchema.parse({ trash: { retentionDays: 30 } }).convert.crf).toBe(24);
  });

  it('validates the step and marks convert jobs', () => {
    expect(StepSchema.safeParse({ type: 'convert', crf: 60 }).success).toBe(false);
    expect(StepSchema.safeParse({ type: 'convert', preset: 'turbo' }).success).toBe(false);
    expect(StepSchema.parse({ type: 'convert', crf: 20, preset: 'slow' })).toEqual({ type: 'convert', crf: 20, preset: 'slow' });
    expect(isConvertJob([{ type: 'rename' }, { type: 'convert' }])).toBe(true);
    expect(isConvertJob([{ type: 'rename' }])).toBe(false);
  });
});
