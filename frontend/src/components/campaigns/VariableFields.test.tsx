import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  VariableFields, missingVariables, previewParams, renderBody, type VariableValues,
} from './VariableFields';

/*
 * The input that did not exist.
 *
 * A campaign was sent against a template opening `Hi {{1}},` and Meta rejected every
 * recipient — `variableValues` was `{}` because the composer read the template's `variables`
 * array and then never asked for anything. Any template with a placeholder was undeliverable
 * to its whole audience, and the campaign was still recorded as sent.
 */

const noop = () => {};

describe('missingVariables', () => {
  it('**reports the placeholder that sank the production campaign**', () => {
    expect(missingVariables(['1'], {})).toEqual(['1']);
  });

  it('counts a blank literal as missing — Meta refuses an empty parameter', () => {
    expect(missingVariables(['1'], { 1: { kind: 'TEXT', value: '  ' } })).toEqual(['1']);
  });

  it('accepts a per-customer value, whose fallback always resolves', () => {
    expect(missingVariables(['1'], {
      1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' },
    })).toEqual([]);
  });

  it('is empty for a template with no placeholders', () => {
    expect(missingVariables([], {})).toEqual([]);
  });
});

describe('the preview', () => {
  it('**shows a per-recipient field as a label, not a guess**', () => {
    // Substituting the fallback would read as though every customer is called "there".
    const values: VariableValues = { 1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' } };
    expect(renderBody('Hi {{1}}, welcome', previewParams(['1'], values)))
      .toBe("Hi [customer's name], welcome");
  });

  it('substitutes a literal as typed', () => {
    const values: VariableValues = { 1: { kind: 'TEXT', value: 'Diwali' } };
    expect(renderBody('Happy {{1}}', previewParams(['1'], values))).toBe('Happy Diwali');
  });

  it('leaves an unfilled placeholder visible while typing', () => {
    expect(renderBody('Hi {{1}}, {{2}}', previewParams(['1', '2'], {})))
      .toBe('Hi {{1}}, {{2}}');
  });
});

describe('the fields', () => {
  const template = ['1'];

  it('renders nothing when the template has no placeholders', () => {
    const { container } = render(
      <VariableFields variables={[]} values={{}} onChange={noop} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('**captures a typed value, which is what was missing entirely**', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<VariableFields variables={template} values={{}} onChange={onChange} />);

    await user.type(screen.getByLabelText('Value for {{1}}'), 'D');

    expect(onChange).toHaveBeenCalledWith({ 1: { kind: 'TEXT', value: 'D' } });
  });

  it('**switches a placeholder to the customer name, with a fallback ready**', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<VariableFields variables={template} values={{}} onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText('What fills {{1}}'), 'customer.name');

    // The fallback is supplied rather than left blank: the one contact with no profile name
    // would otherwise fail on its own, which is the hardest failure to notice.
    expect(onChange).toHaveBeenCalledWith({
      1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' },
    });
  });

  it('offers the fallback for editing once a customer field is chosen', () => {
    render(
      <VariableFields
        variables={template}
        values={{ 1: { kind: 'CUSTOMER', field: 'name', fallback: 'there' } }}
        onChange={noop}
      />,
    );
    expect(screen.getByLabelText('Fallback for {{1}}')).toHaveValue('there');
    expect(screen.queryByLabelText('Value for {{1}}')).not.toBeInTheDocument();
  });

  it('gives every placeholder its own field', () => {
    render(<VariableFields variables={['1', '2']} values={{}} onChange={noop} />);
    expect(screen.getByLabelText('Value for {{1}}')).toBeInTheDocument();
    expect(screen.getByLabelText('Value for {{2}}')).toBeInTheDocument();
  });
});
