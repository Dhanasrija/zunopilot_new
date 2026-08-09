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

/*
 * The field holds line breaks, which for most of this product's life it could not.
 *
 * An `<input>`'s value cannot contain CR or LF — the browser strips them with no error — so a reply
 * with a blank line between two paragraphs was impossible to type, and the Settings editor could
 * already save a multi-line saved reply that the composer would have flattened on its way in.
 */
describe('a reply with more than one line', () => {
  it('**keeps the line breaks it was given**', () => {
    setup({ value: 'We are open:\n11am–11pm, every day.' });

    expect(screen.getByRole('textbox', { name: /reply/i }))
      .toHaveValue('We are open:\n11am–11pm, every day.');
  });

  it('**Shift+Enter adds a line instead of sending**', async () => {
    const { onSend } = setup({ value: 'First line' });

    await userEvent.type(screen.getByRole('textbox', { name: /reply/i }), '{Shift>}{Enter}{/Shift}');

    expect(onSend).not.toHaveBeenCalled();
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

describe('a file the platform cannot send', () => {
  /*
   * **Why this is checked in the browser at all.** The server checks too, and is the
   * authority — but its refusal costs a whole upload first, and beyond about 20 MB the request
   * never reaches it: nginx caps the body and answers 413 with no message of its own, which
   * reached the agent as "Request failed with status code 413" when they tried to send a
   * video.
   */
  const oversized = () => new File(['x'], 'holiday.mp4', { type: 'video/mp4' });

  it('**does not stage it, and says why**', async () => {
    const onSendFile = vi.fn();
    render(
      <Composer
        value="" onChange={vi.fn()} onSend={vi.fn()} sending={false}
        onSendFile={onSendFile}
        checkFile={() => 'That file is 42.0 MB. The limit is MP4 or 3GPP, up to 16 MB.'}
      />,
    );
    await userEvent.upload(
      screen.getByLabelText(/attach a file/i, { selector: 'input' }), oversized(),
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/limit is MP4 or 3GPP, up to 16 MB/);
    // The name must not appear as though it were staged and ready to go.
    expect(screen.queryByText('holiday.mp4')).not.toBeInTheDocument();
  });

  it('cannot be sent by pressing Send anyway', async () => {
    const onSendFile = vi.fn();
    const onSend = vi.fn();
    render(
      <Composer
        value="here you go" onChange={vi.fn()} onSend={onSend} sending={false}
        onSendFile={onSendFile} checkFile={() => 'Too large'}
      />,
    );
    await userEvent.upload(
      screen.getByLabelText(/attach a file/i, { selector: 'input' }), oversized(),
    );
    await userEvent.click(sendButton());

    expect(onSendFile).not.toHaveBeenCalled();
    // The text still goes, because the words were fine — only the file was not.
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('accepts the next file, and clears the warning', async () => {
    let refuse = true;
    render(
      <Composer
        value="" onChange={vi.fn()} onSend={vi.fn()} sending={false}
        onSendFile={vi.fn()} checkFile={() => (refuse ? 'Too large' : null)}
      />,
    );
    const input = screen.getByLabelText(/attach a file/i, { selector: 'input' });
    await userEvent.upload(input, oversized());
    expect(screen.getByRole('alert')).toBeInTheDocument();

    refuse = false;
    await userEvent.upload(input, new File(['x'], 'small.mp4', { type: 'video/mp4' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('small.mp4')).toBeInTheDocument();
  });
});

describe('the reply chip', () => {
  const quoted = { body: 'Can you share the swagger link?', type: 'TEXT', direction: 'INBOUND' as const };

  it('**shows what the reply will quote**', () => {
    /*
     * Above the field and impossible to miss, because the quote is invisible in the text you are
     * typing. An agent who picked Reply four minutes ago and then wrote something unrelated needs
     * to see what it is about to be attached to.
     */
    render(<Composer
      value="" onChange={vi.fn()} onSend={vi.fn()} sending={false}
      replyingTo={quoted} onCancelReply={vi.fn()}
    />);

    expect(screen.getByText(/Can you share the swagger link/)).toBeInTheDocument();
    expect(screen.getByText(/Replying to the customer/i)).toBeInTheDocument();
  });

  it('says whose message it is', () => {
    render(<Composer
      value="" onChange={vi.fn()} onSend={vi.fn()} sending={false}
      replyingTo={{ ...quoted, direction: 'OUTBOUND' }} onCancelReply={vi.fn()}
    />);
    expect(screen.getByText(/Replying to your message/i)).toBeInTheDocument();
  });

  it('can be cancelled', async () => {
    const onCancelReply = vi.fn();
    render(<Composer
      value="" onChange={vi.fn()} onSend={vi.fn()} sending={false}
      replyingTo={quoted} onCancelReply={onCancelReply}
    />);

    await userEvent.click(screen.getByRole('button', { name: /Cancel reply/i }));
    expect(onCancelReply).toHaveBeenCalledOnce();
  });

  it('describes a quoted file rather than showing nothing', () => {
    render(<Composer
      value="" onChange={vi.fn()} onSend={vi.fn()} sending={false}
      replyingTo={{ body: null, type: 'IMAGE', direction: 'INBOUND' }} onCancelReply={vi.fn()}
    />);
    expect(screen.getByText('[image]')).toBeInTheDocument();
  });

  it('is absent when nothing is being quoted', () => {
    render(<Composer value="" onChange={vi.fn()} onSend={vi.fn()} sending={false} />);
    expect(screen.queryByText(/Replying to/i)).not.toBeInTheDocument();
  });
});

/*
 * Asking a question with tappable answers.
 *
 * The composer gains a third meaning for Send — reply, file, question — and the risk is the same
 * one the file staging already has: what the agent is looking at and what Send will do must never
 * disagree. The property with real consequences is the last one: a set that hands the conversation
 * back to the bot has to say so in words, before Send, because an agent who has taken a thread over
 * will not expect to lose it to a button the customer pressed.
 */
const A_SET = {
  id: 'set-1',
  name: 'Delivery or pickup',
  body: 'Would you like delivery or pickup?',
  isActive: true,
  buttons: [
    { id: 'b1', label: 'Delivery', position: 0, workflowId: null, workflow: null },
    { id: 'b2', label: 'Pickup', position: 1, workflowId: null, workflow: null },
  ],
};

const BOUND_SET = {
  ...A_SET,
  id: 'set-2',
  name: 'Book a slot',
  body: 'Would you like to book?',
  buttons: [
    {
      id: 'b3',
      label: 'Yes, book',
      position: 0,
      workflowId: 'wf-1',
      workflow: { id: 'wf-1', name: 'Booking', status: 'PUBLISHED' },
    },
    { id: 'b4', label: 'Not now', position: 1, workflowId: null, workflow: null },
  ],
};

const askControl = () => screen.getByRole('combobox', { name: /reply buttons/i });

describe('asking with reply buttons', () => {
  it('offers nothing when the page has nowhere to send one', () => {
    // Guards the optional prop, the same way the attachment button is guarded.
    setup({ quickReplies: [A_SET] });
    expect(screen.queryByRole('combobox', { name: /reply buttons/i })).not.toBeInTheDocument();
  });

  it('offers nothing when the workspace has saved none', () => {
    setup({ quickReplies: [], onSendQuickReply: vi.fn() });
    expect(screen.queryByRole('combobox', { name: /reply buttons/i })).not.toBeInTheDocument();
  });

  it('**is unavailable once the 24-hour window has closed, and says why**', () => {
    // The control is found by its closed-window name here, because that name *is* the explanation —
    // an agent who cannot use it should be able to read why without pressing it.
    setup({ quickReplies: [A_SET], onSendQuickReply: vi.fn(), windowClosed: true });

    const closed = screen.getByRole('combobox', { name: /24 hours/i });
    expect(closed).toBeDisabled();
  });

  it('**loads the saved question into the field so it can be edited**', async () => {
    const { onChange } = setup({ quickReplies: [A_SET], onSendQuickReply: vi.fn() });

    await userEvent.click(askControl());
    await userEvent.click(screen.getByRole('option', { name: 'Delivery or pickup' }));

    // Handed to the page, not held locally: the field is the page's draft, and the send carries
    // whatever ends up in it.
    expect(onChange).toHaveBeenCalledWith('Would you like delivery or pickup?');
  });

  it('**shows the answers exactly as the customer will see them**', async () => {
    setup({ quickReplies: [A_SET], onSendQuickReply: vi.fn(), value: 'Delivery or pickup?' });

    await userEvent.click(askControl());
    await userEvent.click(screen.getByRole('option', { name: 'Delivery or pickup' }));

    expect(screen.getByText('Delivery')).toBeInTheDocument();
    expect(screen.getByText('Pickup')).toBeInTheDocument();
  });

  it('**says in words when tapping will hand the thread back to the bot**', async () => {
    /*
     * The property with a real consequence. A workflow started into a paused conversation would
     * never hear the customer again, so a bound tap ends the takeover — and an agent handling the
     * thread has to know that before they press Send, not after they lose it.
     */
    setup({ quickReplies: [BOUND_SET], onSendQuickReply: vi.fn(), value: 'Book?' });

    await userEvent.click(askControl());
    await userEvent.click(screen.getByRole('option', { name: 'Book a slot' }));

    // The whole sentence, read as one: "Yes, book" also appears as a pill above, and asserting on
    // the label alone would pass while the warning was missing.
    /*
     * Matched across elements, because the answer's name is emphasised inside the sentence — and
     * the sentence is the point. Asserting on "Yes, book" alone would also match the pill above it
     * and pass with the warning missing entirely.
     */
    expect(screen.getByText(
      (_, element) => element?.tagName === 'P'
        && /tapping\s+yes, book\s+hands this conversation back to the bot/i
          .test(element.textContent ?? ''),
    )).toBeInTheDocument();
  });

  it('says nothing of the sort when no answer is bound', async () => {
    // The reassurance has to be absent when it is not true, or it stops being read.
    setup({ quickReplies: [A_SET], onSendQuickReply: vi.fn(), value: 'Delivery or pickup?' });

    await userEvent.click(askControl());
    await userEvent.click(screen.getByRole('option', { name: 'Delivery or pickup' }));

    expect(screen.queryByText(/back to the bot/i)).not.toBeInTheDocument();
  });

  it('**sends the set and the question instead of a plain reply**', async () => {
    const onSendQuickReply = vi.fn();
    const { onSend } = setup({
      quickReplies: [A_SET], onSendQuickReply, value: 'Asha, delivery or pickup?',
    });

    await userEvent.click(askControl());
    await userEvent.click(screen.getByRole('option', { name: 'Delivery or pickup' }));
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(onSendQuickReply).toHaveBeenCalledWith('set-1', 'Asha, delivery or pickup?');
    expect(onSend).not.toHaveBeenCalled();
  });

  it('**refuses to ask a question with no words in it**', async () => {
    // The answers are not the message. A set with an empty body is a WhatsApp send with no text.
    setup({ quickReplies: [A_SET], onSendQuickReply: vi.fn(), value: '   ' });

    await userEvent.click(askControl());
    await userEvent.click(screen.getByRole('option', { name: 'Delivery or pickup' }));

    expect(screen.getByRole('button', { name: /^ask$/i })).toBeDisabled();
  });

  it('clears the staged set once it has gone, so it cannot be sent twice', async () => {
    const onSendQuickReply = vi.fn();
    setup({ quickReplies: [A_SET], onSendQuickReply, value: 'Delivery or pickup?' });

    await userEvent.click(askControl());
    await userEvent.click(screen.getByRole('option', { name: 'Delivery or pickup' }));
    await userEvent.click(screen.getByRole('button', { name: /^ask$/i }));

    expect(screen.getByRole('button', { name: /^send$/i })).toBeInTheDocument();
    expect(screen.queryByText('Delivery')).not.toBeInTheDocument();
  });

  it('can be cancelled without sending', async () => {
    const onSendQuickReply = vi.fn();
    setup({ quickReplies: [A_SET], onSendQuickReply, value: 'Delivery or pickup?' });

    await userEvent.click(askControl());
    await userEvent.click(screen.getByRole('option', { name: 'Delivery or pickup' }));
    await userEvent.click(screen.getByRole('button', { name: /cancel the question/i }));

    expect(screen.queryByText('Delivery')).not.toBeInTheDocument();
    expect(onSendQuickReply).not.toHaveBeenCalled();
  });

  it('**relabels the field, so it is clear what the words will do**', async () => {
    setup({ quickReplies: [A_SET], onSendQuickReply: vi.fn(), value: 'x' });

    await userEvent.click(askControl());
    await userEvent.click(screen.getByRole('option', { name: 'Delivery or pickup' }));

    expect(screen.getByRole('textbox', { name: /question/i })).toBeInTheDocument();
  });
});
