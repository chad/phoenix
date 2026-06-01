import { describe, it, expect } from 'vitest';
import { classifySignal, stripSpeakerLabel, stripLeadingNoise } from '../../src/signal-classifier.js';

const sig = (s: string): boolean => classifySignal(s).signal;

describe('adversarial: signal-classifier', () => {
  it('#17 a requirement opening with filler (So/Well/FYI) survives', () => {
    expect(sig('So the user must be able to log in')).toBe(true);
    expect(sig('FYI the system must encrypt passwords')).toBe(true);
  });

  it('#18 a requirement opening with a greeting-word (Best/Thanks) survives', () => {
    expect(sig('Best price must be shown to users')).toBe(true);
  });

  it('#33 a requirement opening with a non-time colon number (16:9, 99:99) survives; real times drop', () => {
    expect(sig('16:9 aspect ratio must be supported')).toBe(true);
    expect(sig('99:99 is invalid and must be rejected')).toBe(true);
    expect(sig('10:30 standup notes')).toBe(false); // real time → noise
  });

  it('#34 domain words minutes/sidebar are not meeting-meta noise', () => {
    expect(sig('sessions expire after 30 minutes of inactivity')).toBe(true);
    expect(sig('the sidebar shows recent files')).toBe(true);
  });

  it('#35 instructional verbs are not deferral noise', () => {
    expect(sig('revisit the validation logic for emails')).toBe(true);
    expect(sig('show the table this user owns')).toBe(true);
  });

  it('#37 conversational filler "this is a good point" is NOT forced normative', () => {
    // The bug was the false-confidence 'normative' label from a bare 'is a' match. The
    // recall-biased gate may still keep it (as 'unsure-keep'), but never as normative.
    expect(classifySignal('This is a good point').reason).not.toBe('normative');
    // a REAL definition is still normative
    expect(classifySignal('A widget is defined as a reusable UI element').reason).toBe('normative');
  });

  it('#19 a domain prefix (Account:/Search:) is not stripped as a speaker label', () => {
    expect(stripSpeakerLabel('Account: must be unique per user')).toBe('Account: must be unique per user');
    expect(stripSpeakerLabel('Smith: create the account')).toBe('create the account'); // a real speaker still stripped
  });

  it('#36 stripLeadingNoise keeps a meaningful 1-char leading segment', () => {
    expect(stripLeadingNoise('x - users must create accounts')).toBe('x - users must create accounts');
  });

  it('#41 a bare dangling speaker label is dropped as noise', () => {
    expect(sig('Mary Smith: ')).toBe(false);
  });
});
