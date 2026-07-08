import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'

// Mock @langchain/core/tools — imported by tool-definitions at top level
vi.mock('@langchain/core/tools', () => ({
  tool: vi.fn(),
}))

// Mock mcp-client — imported by tool-definitions at top level
vi.mock('../../electron/mcp-client', () => ({
  callTool: vi.fn(),
  callToolWithUrl: vi.fn(),
  listToolsWithUrl: vi.fn(),
}))

// Now import the function under test
import { jsonSchemaToZod } from '../../electron/agent/tool-definitions'

describe('jsonSchemaToZod', () => {
  describe('primitive types', () => {
    it('converts string type', () => {
      const schema = jsonSchemaToZod({ type: 'string' })
      expect(schema).toBeInstanceOf(z.ZodString)
      // Validate a string value passes
      expect(schema.parse('hello')).toBe('hello')
    })

    it('converts number type', () => {
      const schema = jsonSchemaToZod({ type: 'number' })
      expect(schema).toBeInstanceOf(z.ZodNumber)
      expect(schema.parse(42)).toBe(42)
    })

    it('converts integer type to ZodNumber', () => {
      const schema = jsonSchemaToZod({ type: 'integer' })
      expect(schema).toBeInstanceOf(z.ZodNumber)
      expect(schema.parse(7)).toBe(7)
    })

    it('converts boolean type', () => {
      const schema = jsonSchemaToZod({ type: 'boolean' })
      expect(schema).toBeInstanceOf(z.ZodBoolean)
      expect(schema.parse(true)).toBe(true)
    })
  })

  describe('enum type', () => {
    it('converts enum values', () => {
      const schema = jsonSchemaToZod({ enum: ['red', 'green', 'blue'] })
      expect(schema).toBeInstanceOf(z.ZodEnum)
      expect(schema.parse('red')).toBe('red')
    })

    it('rejects values not in enum', () => {
      const schema = jsonSchemaToZod({ enum: ['a', 'b'] })
      expect(() => schema.parse('c')).toThrow()
    })

    it('enum takes precedence over type', () => {
      const schema = jsonSchemaToZod({ type: 'string', enum: ['x', 'y'] })
      expect(schema).toBeInstanceOf(z.ZodEnum)
      expect(() => schema.parse('z')).toThrow()
    })
  })

  describe('array type', () => {
    it('converts array with typed items', () => {
      const schema = jsonSchemaToZod({
        type: 'array',
        items: { type: 'string' },
      })
      expect(schema).toBeInstanceOf(z.ZodArray)
      expect(schema.parse(['a', 'b'])).toEqual(['a', 'b'])
    })

    it('converts array without items to z.array(z.any())', () => {
      const schema = jsonSchemaToZod({ type: 'array' })
      expect(schema).toBeInstanceOf(z.ZodArray)
      // Should accept any item types
      expect(schema.parse([1, 'two', true])).toEqual([1, 'two', true])
    })

    it('converts array with nested object items', () => {
      const schema = jsonSchemaToZod({
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
          },
          required: ['id'],
        },
      })
      expect(schema.parse([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }])
    })
  })

  describe('object type', () => {
    it('converts object with properties', () => {
      const schema = jsonSchemaToZod({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      })
      // Required property
      expect(schema.parse({ name: 'Alice' })).toEqual({ name: 'Alice' })
      // With optional
      expect(schema.parse({ name: 'Bob', age: 30 })).toEqual({ name: 'Bob', age: 30 })
    })

    it('marks non-required properties as optional', () => {
      const schema = jsonSchemaToZod({
        type: 'object',
        properties: {
          required_field: { type: 'string' },
          optional_field: { type: 'number' },
        },
        required: ['required_field'],
      })
      // Should pass without optional_field
      const result = schema.parse({ required_field: 'test' })
      expect(result).toEqual({ required_field: 'test' })
    })

    it('converts object without properties to z.record(z.any())', () => {
      const schema = jsonSchemaToZod({ type: 'object' })
      expect(schema).toBeInstanceOf(z.ZodRecord)
      expect(schema.parse({ anything: 'goes' })).toEqual({ anything: 'goes' })
    })

    it('preserves description on properties', () => {
      const schema = jsonSchemaToZod({
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The user name' },
        },
        required: ['name'],
      })
      // ZodObject shape should have a description on the name field
      const nameField = (schema as z.ZodObject<z.ZodRawShape>).shape.name
      expect(nameField.description).toBe('The user name')
    })

    it('handles nested objects', () => {
      const schema = jsonSchemaToZod({
        type: 'object',
        properties: {
          address: {
            type: 'object',
            properties: {
              city: { type: 'string' },
              zip: { type: 'string' },
            },
            required: ['city'],
          },
        },
        required: ['address'],
      })
      expect(schema.parse({ address: { city: 'NYC' } })).toEqual({
        address: { city: 'NYC' },
      })
    })

    it('marks all properties optional when required array is absent', () => {
      const schema = jsonSchemaToZod({
        type: 'object',
        properties: {
          a: { type: 'string' },
          b: { type: 'number' },
        },
      })
      // Both should be optional — empty object should pass
      expect(schema.parse({})).toEqual({})
    })
  })

  describe('fallback / unknown types', () => {
    it('maps type null to z.null()', () => {
      const schema = jsonSchemaToZod({ type: 'null' })
      expect(schema.safeParse(null).success).toBe(true)
      expect(schema.safeParse('x').success).toBe(false)
    })

    it('falls back to z.any() for missing type', () => {
      const schema = jsonSchemaToZod({})
      expect(schema).toBeInstanceOf(z.ZodAny)
    })

    it('converts allOf of mixed branches via intersection', () => {
      const schema = jsonSchemaToZod({
        allOf: [{ type: 'string' }, { minLength: 1 }],
      })
      // string branch enforced; the unsupported minLength branch degrades to any
      expect(schema.safeParse('hello').success).toBe(true)
      expect(schema.safeParse(42).success).toBe(false)
    })
  })
})

// ---------------------------------------------------------------------------
// Real n8n MCP server schemas (ground truth from
// n8n-master/packages/cli/src/modules/mcp/) — the discriminated-union
// execute_workflow inputs and anyOf-based get_node_types must round-trip.
// ---------------------------------------------------------------------------

describe('real n8n MCP schemas', () => {
  it('execute_workflow: accepts chat/form/webhook inputs, rejects garbage', () => {
    // JSON Schema serialization of the server's zod discriminatedUnion
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        workflowId: { type: 'string', description: 'The ID of the workflow to execute' },
        executionMode: { type: 'string', enum: ['manual', 'production'], default: 'production' },
        inputs: {
          anyOf: [
            {
              type: 'object',
              properties: {
                type: { const: 'chat' },
                chatInput: { type: 'string' },
              },
              required: ['type', 'chatInput'],
            },
            {
              type: 'object',
              properties: {
                type: { const: 'form' },
                formData: { type: 'object', additionalProperties: {} },
              },
              required: ['type', 'formData'],
            },
            {
              type: 'object',
              properties: {
                type: { const: 'webhook' },
                webhookData: {
                  type: 'object',
                  properties: {
                    method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'], default: 'GET' },
                    query: { type: 'object', additionalProperties: { type: 'string' } },
                    body: { type: 'object', additionalProperties: {} },
                  },
                },
              },
              required: ['type', 'webhookData'],
            },
          ],
        },
      },
      required: ['workflowId'],
    })

    expect(schema.safeParse({
      workflowId: '42',
      executionMode: 'manual',
      inputs: { type: 'chat', chatInput: 'hello' },
    }).success).toBe(true)

    expect(schema.safeParse({
      workflowId: '42',
      inputs: { type: 'webhook', webhookData: { method: 'POST', body: { a: 1 } } },
    }).success).toBe(true)

    // Old client bug shape: inputData is not a valid field but extra keys are
    // stripped/ignored by zod objects — the critical check is that the REAL
    // fields validate and a malformed union member fails.
    expect(schema.safeParse({
      workflowId: '42',
      inputs: { type: 'chat' }, // missing chatInput
    }).success).toBe(false)

    expect(schema.safeParse({ inputs: { type: 'chat', chatInput: 'x' } }).success).toBe(false) // missing workflowId
  })

  it('search_nodes: queries must be a non-empty string array', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        queries: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
      required: ['queries'],
    })
    expect(schema.safeParse({ queries: ['gmail', 'slack'] }).success).toBe(true)
    // The OLD hardcoded wrapper sent { query: string } — must fail now
    expect(schema.safeParse({ query: 'gmail' }).success).toBe(false)
  })

  it('get_node_types: anyOf(string | object-with-discriminators) round-trips', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          items: {
            anyOf: [
              { type: 'string' },
              {
                type: 'object',
                properties: {
                  nodeId: { type: 'string' },
                  resource: { type: 'string' },
                  operation: { type: 'string' },
                },
                required: ['nodeId'],
              },
            ],
          },
        },
      },
      required: ['nodeIds'],
    })
    expect(schema.safeParse({ nodeIds: ['n8n-nodes-base.gmail'] }).success).toBe(true)
    expect(schema.safeParse({
      nodeIds: [{ nodeId: 'n8n-nodes-base.gmail', resource: 'message', operation: 'send' }],
    }).success).toBe(true)
    expect(schema.safeParse({ nodeIds: [42] }).success).toBe(false)
  })

  it('numeric enums survive conversion', () => {
    const schema = jsonSchemaToZod({ enum: [1, 2, 3] })
    expect(schema.safeParse(2).success).toBe(true)
    expect(schema.safeParse(4).success).toBe(false)
    expect(schema.safeParse('2').success).toBe(false)
  })

  it('nullable type arrays survive conversion', () => {
    const schema = jsonSchemaToZod({ type: ['string', 'null'] })
    expect(schema.safeParse('x').success).toBe(true)
    expect(schema.safeParse(null).success).toBe(true)
    expect(schema.safeParse(5).success).toBe(false)
  })

  it('defaults are applied', () => {
    const schema = jsonSchemaToZod({
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['manual', 'production'], default: 'production' },
      },
    })
    const parsed = schema.parse({})
    expect((parsed as { mode: string }).mode).toBe('production')
  })
})
