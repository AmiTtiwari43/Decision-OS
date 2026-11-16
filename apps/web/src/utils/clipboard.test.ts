import { describe, it, expect, afterEach, vi } from 'vitest';
import { copyTextToClipboard } from './clipboard';

describe('copyTextToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves true when the Clipboard API accepts the write', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyTextToClipboard('hash-123')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hash-123');
  });

  it('resolves false (never throws) when permission is denied and no fallback exists', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Write permission denied.', 'NotAllowedError'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyTextToClipboard('secret-briefing')).resolves.toBe(false);
  });

  it('uses the selection fallback when the Clipboard API is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    const textarea = { value: '', style: {} as Record<string, string>, setAttribute: vi.fn(), select: vi.fn() };
    const execCommand = vi.fn().mockReturnValue(true);
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue(textarea),
      execCommand,
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });

    await expect(copyTextToClipboard('fallback text')).resolves.toBe(true);
    expect(textarea.value).toBe('fallback text');
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('reports failure when the fallback copy command is rejected', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', {
      createElement: vi.fn().mockReturnValue({ style: {}, setAttribute: vi.fn(), select: vi.fn() }),
      execCommand: vi.fn().mockReturnValue(false),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });

    await expect(copyTextToClipboard('x')).resolves.toBe(false);
  });
});
