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
  it('**has no emoji picker**', () => {
    /*
     * The design reference shows one. It is not here, because a control that does nothing is
     * worse than an absent one — the same call made on the Customers page.
     *
     * The attachment button beside it *is* here now, and used to be refused for the same
     * reason: sending media meant an upload, a Meta media id and a type the thread could not
     * render. All three exist, so the reason expired and the control arrived.
     */
    setup({ value: 'hi' });
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/send/i);
  });

  it('offers no attachment button when the page has nowhere to send one', () => {
    // `onSendFile` absent means the caller cannot handle a file. Drawing the paperclip anyway
    // would be a button that silently does nothing.
    setup({ value: 'hi' });
    expect(screen.queryByRole('button', { name: /attach/i })).not.toBeInTheDocument();
  });
});

// ── Sending a file ────────────────────────────────────────────────────────────

const attach = async (name = 'invoice.pdf') => {
  const file = new File(['x'], name, { type: 'application/pdf' });
  // The input is hidden, which `upload` handles and `click` would not.
  await userEvent.upload(screen.getByLabelText(/attach a file/i, { selector: 'input' }), file);
  return file;
};

const withFile = (props: Partial<Parameters<typeof Composer>[0]> = {}) => {
  const onSend = vi.fn();
  const onSendFile = vi.fn();
  const onChange = vi.fn();
  const { rerender } = render(
    <Composer
      value=""
      onChange={onChange}
      onSend={onSend}
      sending={false}
      onSendFile={onSendFile}
      {...props}
    />,
  );
  return { onSend, onSendFile, onChange, rerender };
};

describe('attaching a file', () => {
  it('names the staged file before it is sent', async () => {
    withFile();
    await attach('quote-final-v2.pdf');
    expect(screen.getByText('quote-final-v2.pdf')).toBeInTheDocument();
  });

  it('**sends the file instead of the text, with the text as its caption**', async () => {
    const { onSend, onSendFile } = withFile({ value: 'Here you go' });
    await attach();
    await userEvent.click(sendButton());

    expect(onSendFile).toHaveBeenCalledWith(expect.any(File), 'Here you go');
    // The one that must not happen: a file send that also fires a separate text message.
    expect(onSend).not.toHaveBeenCalled();
  });

  it('**sends a file with no caption at all**', async () => {
    // An empty draft disables Send for text. With a file staged it must not, or a photograph
    // could only be sent alongside words.
    const { onSendFile } = withFile({ value: '' });
    await attach();
    expect(sendButton()).toBeEnabled();

    await userEvent.click(sendButton());
    expect(onSendFile).toHaveBeenCalledWith(expect.any(File), '');
  });

  it('can be taken back off before sending', async () => {
    const { onSendFile, onSend } = withFile({ value: 'hi' });
    await attach();
    await userEvent.click(screen.getByRole('button', { name: /remove invoice\.pdf/i }));

    expect(screen.queryByText('invoice.pdf')).not.toBeInTheDocument();
    await userEvent.click(sendButton());
    expect(onSendFile).not.toHaveBeenCalled();
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('clears the staged file once it has gone, so it cannot be sent twice', async () => {
    const { onSendFile } = withFile({ value: '' });
    await attach();
    await userEvent.click(sendButton());
    expect(onSendFile).toHaveBeenCalledOnce();
    expect(screen.queryByText('invoice.pdf')).not.toBeInTheDocument();
  });

  it('relabels the field as a caption, so it is clear what the words will do', async () => {
    withFile();
    await attach();
    expect(screen.getByRole('textbox', { name: /caption/i })).toBeInTheDocument();
  });

  it('locks out while the upload is in flight', async () => {
    const { onSendFile } = withFile({ value: 'hi', attaching: true });
    expect(sendButton()).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: /reply/i }), '{Enter}');
    expect(onSendFile).not.toHaveBeenCalled();
  });
});

describe('outside the 24-hour window', () => {
  it('**refuses the attachment and says why**', async () => {
    /*
     * WhatsApp then accepts templates only, and a template's media is fixed at approval — so
     * there is no send that would have worked. The server refuses it too; this is so the agent
     * finds out before choosing a file rather than after uploading one.
     */
    withFile({ windowClosed: true });
    const button = screen.getByRole('button', { name: /24 hours/i });
    expect(button).toBeDisabled();
  });

  it('still lets a text reply through, because the server may disagree', async () => {
    // The window is computed here from the thread the page happens to hold. It is a hint, and
    // the send path is the authority — so this must not disable replying.
    const { onSend } = withFile({ value: 'hi', windowClosed: true });
    await userEvent.click(sendButton());
    expect(onSend).toHaveBeenCalledOnce();
  });
});
