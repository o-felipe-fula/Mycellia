import YAML from 'yaml';

export interface ParsedNote {
  rawFrontmatter: string;
  yamlDoc: YAML.Document | null;
  content: string;
}

// Separa o frontmatter YAML cru do corpo do Markdown
export function parseRawNote(rawContent: string): ParsedNote {
  const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n/;
  const match = rawContent.match(frontmatterRegex);

  if (match) {
    const rawFrontmatter = match[0]; // Inclui os delimitadores --- e quebras de linha
    const yamlString = match[1]; // Apenas o corpo do YAML
    const bodyContent = rawContent.substring(match[0].length);
    try {
      const doc = YAML.parseDocument(yamlString);
      return {
        rawFrontmatter,
        yamlDoc: doc,
        content: bodyContent,
      };
    } catch (e) {
      console.error('Error parsing frontmatter YAML, treating as plain text:', e);
      return {
        rawFrontmatter: '',
        yamlDoc: null,
        content: rawContent,
      };
    }
  }

  return {
    rawFrontmatter: '',
    yamlDoc: null,
    content: rawContent,
  };
}

// Concatena o frontmatter bruto com o corpo do markdown de forma literal e segura
export function serializeRawNote(rawFrontmatter: string | null, content: string): string {
  return (rawFrontmatter || '') + content;
}
