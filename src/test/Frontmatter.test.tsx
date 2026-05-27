import { describe, it, expect } from 'vitest';
import { parseRawNote, serializeRawNote } from '../utils/markdown';

const rawNoteWithComments = `---
# Cabecalho de teste de Mycellia
type: note
tags: [test, personal] # Uma tag de exemplo
# Outro comentario
owner: Felipe
---
# Titulo da Nota

Este e o corpo da nota.
`;

describe('YAML Frontmatter Round-Trip Tests (Principle #1)', () => {
  it('deve separar corretamente o frontmatter e o corpo', () => {
    const { rawFrontmatter, yamlDoc, content } = parseRawNote(rawNoteWithComments);

    expect(rawFrontmatter).toContain('# Cabecalho de teste de Mycellia');
    expect(rawFrontmatter).toContain('type: note');
    expect(rawFrontmatter).toContain('tags: [test, personal] # Uma tag de exemplo');
    expect(rawFrontmatter).toContain('owner: Felipe');
    expect(yamlDoc).not.toBeNull();
    expect(yamlDoc?.get('type')).toBe('note');
    expect(yamlDoc?.get('owner')).toBe('Felipe');
    expect(content).toBe('# Titulo da Nota\n\nEste e o corpo da nota.\n');
  });

  it('deve reter o frontmatter byte a byte identico ao editar apenas o corpo', () => {
    const { rawFrontmatter } = parseRawNote(rawNoteWithComments);

    const newBodyContent = '# Titulo da Nota\n\nCorpo editado pelo usuario!';
    const serialized = serializeRawNote(rawFrontmatter, newBodyContent);

    // Divide e verifica o cabecalho novamente
    const parsedAgain = parseRawNote(serialized);
    expect(parsedAgain.rawFrontmatter).toBe(rawFrontmatter);
    expect(parsedAgain.content).toBe(newBodyContent);
  });

  it('deve alterar apenas a propriedade modificada no YAML mantendo comentarios e estilo das demais', () => {
    const { yamlDoc, content } = parseRawNote(rawNoteWithComments);
    expect(yamlDoc).not.toBeNull();

    // Modifica apenas 'owner'
    yamlDoc!.set('owner', 'Felipe Fulanetti');

    // Modifica via toString()
    const newYamlString = yamlDoc!.toString().trim();
    const newRawFrontmatter = `---\n${newYamlString}\n---\n`;

    const serialized = serializeRawNote(newRawFrontmatter, content);

    // Verifica o resultado
    expect(serialized).toContain('# Cabecalho de teste de Mycellia'); // Comentario inicial mantido!
    expect(serialized).toContain('tags: [ test, personal ] # Uma tag de exemplo'); // Comentario da tag mantido!
    expect(serialized).toContain('owner: Felipe Fulanetti'); // Modificado!
    expect(serialized).not.toContain('owner: Felipe\n'); // O antigo valor sumiu
  });
});
