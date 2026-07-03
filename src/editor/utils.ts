// Utilitários puros do editor (F3 — Spec 17), extraídos intactos do MarkdownEditor.tsx:
// parsing de fenced code, resolução de imagem contra a árvore do vault e detecção de
// code-block na árvore do Lezer. Leitura-apenas do store (platform) — nada de save.
import { EditorState } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import type { SyntaxNode } from '@lezer/common';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useAppStore, FileNode } from '../store/appStore';

export function getFencedCodeContent(rawText: string): string {
  const lines = rawText.split('\n');
  if (lines.length === 0) return '';
  if (lines.length === 1) return '';
  const lastLine = lines[lines.length - 1].trim();
  const hasClosingFence = lastLine.startsWith('```') || lastLine.startsWith('~~~');
  if (hasClosingFence) {
    return lines.slice(1, lines.length - 1).join('\n');
  } else {
    return lines.slice(1).join('\n');
  }
}

export function findFileInTree(node: FileNode, name: string): string | null {
  if (!node.is_dir && node.name.toLowerCase() === name.toLowerCase()) {
    return node.path;
  }
  if (node.is_dir && node.children) {
    for (const child of node.children) {
      const found = findFileInTree(child, name);
      if (found) return found;
    }
  }
  return null;
}

export function findFilePathInTree(node: FileNode, targetPath: string): boolean {
  const isWindows = useAppStore.getState().platform === 'windows';
  const cleanNodePath = node.path.replace(/\\/g, '/');
  const cleanTargetPath = targetPath.replace(/\\/g, '/');
  if (isWindows ? cleanNodePath.toLowerCase() === cleanTargetPath.toLowerCase() : cleanNodePath === cleanTargetPath) {
    return true;
  }
  if (node.is_dir && node.children) {
    for (const child of node.children) {
      if (findFilePathInTree(child, targetPath)) return true;
    }
  }
  return false;
}

export function resolveImagePath(
  src: string,
  activeNotePath: string | null,
  vaultPath: string | null,
  fileTree: FileNode | null,
): { url: string; exists: boolean } {
  if (
    src.startsWith('http://') ||
    src.startsWith('https://')
  ) {
    return { url: src, exists: true };
  }

  if (
    /^[a-zA-Z]:\\/.test(src) ||
    src.startsWith('/')
  ) {
    return { url: convertFileSrc(src), exists: true };
  }

  // Extract base name to search in fileTree
  const baseName = src.includes('/') || src.includes('\\')
    ? (src.split(/[/\\]/).pop() || src)
    : src;

  if (fileTree) {
    const foundPath = findFileInTree(fileTree, baseName);
    if (foundPath) {
      return { url: convertFileSrc(foundPath), exists: true };
    }
  }

  if (activeNotePath && vaultPath) {
    const noteDir =
      activeNotePath.substring(0, activeNotePath.lastIndexOf('\\') + 1) ||
      activeNotePath.substring(0, activeNotePath.lastIndexOf('/') + 1);

    const relativePath = noteDir + src;
    if (fileTree && findFilePathInTree(fileTree, relativePath)) {
      return { url: convertFileSrc(relativePath), exists: true };
    }
  }

  return { url: '', exists: false };
}

export function isInsideCodeBlock(state: EditorState, pos: number): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos);
  while (node) {
    if (
      node.name === 'FencedCode' ||
      node.name === 'CodeBlock' ||
      node.name === 'InlineCode' ||
      node.name === 'CodeText'
    ) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

export function isRangeInCode(state: EditorState, from: number, to: number): boolean {
  let inCode = false;
  syntaxTree(state).iterate({
    from,
    to,
    enter(node) {
      if (
        node.name === 'FencedCode' ||
        node.name === 'CodeBlock' ||
        node.name === 'InlineCode' ||
        node.name === 'CodeText'
      ) {
        inCode = true;
        return false;
      }
      return true;
    },
  });
  return inCode;
}

export function hasChildTaskMarker(node: SyntaxNode): boolean {
  let found = false;
  const traverse = (n: SyntaxNode) => {
    if (n.name === 'TaskMarker') {
      found = true;
      return;
    }
    let child = n.firstChild;
    while (child && !found) {
      traverse(child);
      child = child.nextSibling;
    }
  };
  traverse(node);
  return found;
}
