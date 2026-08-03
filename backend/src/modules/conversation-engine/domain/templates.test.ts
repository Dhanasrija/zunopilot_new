import { describe, expect, it } from 'vitest';
import { WORKFLOW_TEMPLATES, templateById, templateReadiness } from './templates.js';
import { validateWorkflowDefinition } from '../validation/definition-validator.js';
import { nodeMap, outgoingEdges } from './definition.js';

// Templates are shipped graphs, so the thing worth testing is that every one of
// them would survive the same publish check a hand-built workflow faces. A
// template that cannot be published is worse than no template — the author only
// finds out after instantiating and customising it.

describe('every template', () => {
  for (const template of WORKFLOW_TEMPLATES) {
    it(`"${template.name}" passes the publish validator`, () => {
      const result = validateWorkflowDefinition({
        definition: template.definition,
        category: 'CONVERSATION',
        capability: template.capability,
        slug: template.suggestedSlug,
        siblingSlugs: [],
      });

      expect(result.issues.filter((i) => i.level === 'error')).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it(`"${template.name}" has no unreachable or dead-end nodes it did not mean`, () => {
      const result = validateWorkflowDefinition({
        definition: template.definition,
        category: 'CONVERSATION',
        capability: template.capability,
        slug: template.suggestedSlug,
      });

      // Warnings are allowed in general — an unbuilt node type is one — but
      // these three mean the graph is wired wrong, which no shipped template
      // should be.
      const structural = result.issues.filter((i) => ['UNREACHABLE_NODE', 'DEAD_END', 'UNKNOWN_VARIABLE'].includes(i.code));
      expect(structural).toEqual([]);
    });
  }
});

describe('the Place an Order template', () => {
  const template = templateById('order_place')!;
  const nodes = nodeMap(template.definition);

  it('is fully runnable — every node type it uses has an executor', () => {
    expect(templateReadiness(template)).toEqual({ available: true, missingRuntimes: [] });
  });

  it('reads the live catalogue rather than hand-typed rows', () => {
    expect(nodes.get('pick_category')!.config).toMatchObject({ source: 'menu_categories' });
    expect(nodes.get('pick_item')!.config).toMatchObject({
      source: 'menu_items',
      categoryVariable: 'chosen_category',
    });
  });

  it('keeps the basket in workflow variables, never the Cart table', () => {
    // The load-bearing decision: step 0 of the routing chain hands a live `Cart`
    // row to the legacy state machine, so a workflow writing there would be
    // hijacked on the next message.
    for (const nodeId of ['add_to_basket', 'basket_summary', 'place_order']) {
      expect(nodes.get(nodeId)!.config).toMatchObject({ cartVariable: 'cart' });
    }
    expect(nodes.get('add_to_basket')!.type).toBe('CART_ADD_ITEM');
  });

  it('loops back to the catalogue when the customer wants another item', () => {
    const yes = outgoingEdges(template.definition, 'wants_more').find((e) => e.sourceHandle === 'yes');
    expect(yes?.target).toBe('pick_category');
  });

  it('never places the order without an explicit confirmation tap', () => {
    const intoCreate = template.definition.edges.filter((e) => e.target === 'place_order');
    expect(intoCreate).toHaveLength(1);

    const gate = nodes.get(intoCreate[0]!.source)!;
    expect(gate.type).toBe('CONDITION');
    expect(gate.config).toMatchObject({ right: 'confirm_order' });

    // …and that condition is fed by a button the customer has to tap.
    const asks = template.definition.edges.filter((e) => e.target === gate.id);
    expect(nodes.get(asks[0]!.source)!.type).toBe('BUTTON_MESSAGE');
  });

  it('handles a failed order rather than ending silently', () => {
    const error = outgoingEdges(template.definition, 'place_order').find((e) => e.sourceHandle === 'error');
    expect(nodes.get(error!.target)!.type).toBe('HUMAN_HANDOFF');
  });

  it('avoids button titles the engine treats as escape hatches', () => {
    // A whole message of exactly "cancel" tears the instance down before the
    // waiting node ever sees the tap, so no button may be titled that.
    const reserved = new Set(['cancel', 'stop', 'exit', 'quit', 'restart', 'menu', 'agent', 'human', 'support']);
    for (const node of template.definition.nodes) {
      const buttons = (node.config as { buttons?: Array<{ title: string }> }).buttons ?? [];
      for (const button of buttons) {
        expect(reserved.has(button.title.trim().toLowerCase())).toBe(false);
      }
    }
  });
});
