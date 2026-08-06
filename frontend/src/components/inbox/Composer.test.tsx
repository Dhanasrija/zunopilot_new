import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Composer } from './Composer';

// The reply box has one job and two ways to get it wrong: sending nothing, and sending twice.

const setup = (props: Partial<Parameters<typeof Composer>[0]> = {}) => {
  const onSend = vi.fn();
  const onChange = vi.fn();
  render(<Composer value="" onChange={onChange} onSend={onSend} sending={false} {...props} />);
  return { onSend, onChange };
};

const sendButton = () => screen.getByRole('button', { name: /send/i });

describe('when a reply can be sent', () => {
  it('sends on click', async () => {
    const { onSend } = setup({ value: 'On its way' });
    await userEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('sends on Enter, because that is what every chat app does', async () => {
    const { onSend } = setup({ value: 'On its way' });
    await userEvent.type(screen.getByRole('textbox', { name: /reply/i }), '{Enter}');
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('reports every keystroke so the page owns the draft', async () => {
    const { onChange } = setup();
    await userEvent.type(screen.getByRole('textbox', { name: /reply/i }), 'hi');
    expect(onChange).toHaveBeenCalled();
  });
});

describe('when it cannot', () => {
  it('**refuses an empty draft, and one that is only whitespace**', () => {
    // Whitespace matters: a customer receiving a blank WhatsApp message is worse than no reply,
    // and `value.trim()` is the only thing standing between them.
    const { unmount } = render(<Composer value="" onChange={vi.fn()} onSend={vi.fn()} sending={false} />);
    expect(sendButton()).toBeDisabled();
    unmount();

    setup({ value: '   \n  ' });
    expect(sendButton()).toBeDisabled();
  });

  it('does not send on Enter with an empty draft', async () => {
    const { onSend } = setup({ value: '  ' });
    await userEvent.type(screen.getByRole('textbox', { name: /reply/i }), '{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('**locks out while a send is in flight, so a slow network cannot double-send**', async () => {
    const { onSend } = setup({ value: 'On its way', sending: true });
    expect(sendButton()).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: /reply/i }), '{Enter}');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('says so while sending', () => {
    setup({ value: 'On its way', sending: true });
    expect(screen.getByRole('button', { name: /sending/i })).toBeInTheDocument();
  });
});

describe('what it deliberately does not offer', () => {
  it('**has no emoji picker and no attachment button**', () => {
    /*
     * The design reference shows both. Neither is here, because sending media means an upload,
     * a Meta media id and a message type this thread cannot render — a feature, not a style.
     * A control that does nothing is worse than an absent one.
     *
     * Asserted rather than left to memory: the next person working from the same reference will
     * reach for them, and this says why they were left out.
     */
    setup({ value: 'hi' });
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/send/i);
  });
});
