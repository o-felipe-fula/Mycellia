// Widgets DOM do live preview (F3 — Spec 17): classes puras de renderização, extraídas
// intactas do MarkdownEditor.tsx. Nenhuma relação com o fluxo de save; o TaskMarkerWidget
// despacha a troca [ ]/[x] direto no buffer do editor (byte-a-byte, Incidentes 04/07).
import { EditorView, WidgetType } from '@codemirror/view';
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language';

export class EmptyWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-hidden-syntax-placeholder';
    span.style.display = 'none';
    return span;
  }

  eq() {
    return true;
  }
}

export class TableWidget extends WidgetType {
  constructor(readonly rawText: string) {
    super();
  }

  toDOM() {
    const container = document.createElement('div');
    container.className = 'mycellia-table-container overflow-x-auto w-full my-3';

    const table = document.createElement('table');
    table.className = 'mycellia-table-wrapper w-full border-collapse font-sans text-sm select-text';

    const lines = this.rawText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return container;

    const thead = document.createElement('thead');
    const tbody = document.createElement('tbody');

    let isHeader = true;
    for (const line of lines) {
      const cells = line.split('|').map(c => c.trim());
      if (line.startsWith('|')) {
        cells.shift();
      }
      if (line.endsWith('|')) {
        cells.pop();
      }

      const isDelimiter = cells.every(c => /^[:-]+$/.test(c));
      if (isDelimiter) {
        continue;
      }

      const tr = document.createElement('tr');
      tr.className = 'hover:bg-[var(--substrate-raised)] transition-colors';

      for (const cellText of cells) {
        const cell = document.createElement(isHeader ? 'th' : 'td');
        if (isHeader) {
          cell.className = 'border border-[var(--border-subtle)] px-3 py-2 bg-[var(--substrate-raised)] text-[var(--text-primary)] font-semibold text-left';
        } else {
          cell.className = 'border border-[var(--border-subtle)] px-3 py-2 text-[var(--text-secondary)]';
        }
        cell.textContent = cellText;
        tr.appendChild(cell);
      }

      if (isHeader) {
        thead.appendChild(tr);
        isHeader = false;
      } else {
        tbody.appendChild(tr);
      }
    }

    table.appendChild(thead);
    table.appendChild(tbody);
    container.appendChild(table);
    return container;
  }

  eq(other: TableWidget) {
    return other.rawText === this.rawText;
  }
}

export class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-bullet-mark inline-block text-[var(--accent-dim)] mx-1.5 transform scale-125';
    span.textContent = '•';
    return span;
  }

  eq() {
    return true;
  }
}

export class TaskMarkerWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }

  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = 'cm-task-marker-wrapper inline-flex items-center align-middle mr-1.5';

    const checkbox = document.createElement('span');
    checkbox.className = `cm-task-marker-box ${this.checked ? 'checked' : ''}`;

    if (this.checked) {
      const check = document.createElement('span');
      check.style.position = 'absolute';
      check.style.left = '4px';
      check.style.top = '1px';
      check.style.width = '4px';
      check.style.height = '8px';
      check.style.border = 'solid var(--substrate-base)';
      check.style.borderWidth = '0 2px 2px 0';
      check.style.transform = 'rotate(45deg)';
      checkbox.appendChild(check);
    }

    checkbox.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      ensureSyntaxTree(view.state, view.state.doc.length, 50);
      const pos = view.posAtDOM(checkbox);
      const tree = syntaxTree(view.state);
      const node = tree.resolveInner(pos, 1);

      if (node && node.name === 'TaskMarker') {
        const activeLineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;
        const nodeLine = view.state.doc.lineAt(node.from).number;

        // CORREÇÃO OBRIGATÓRIA — clique só vale no estado decorado
        if (nodeLine === activeLineNumber) {
          return;
        }

        const rawText = view.state.doc.sliceString(node.from, node.to);
        const isChecked = rawText.toLowerCase().includes('x');
        const newText = isChecked ? '[ ]' : '[x]';

        view.dispatch({
          changes: {
            from: node.from,
            to: node.to,
            insert: newText,
          },
        });
      }
    });

    span.appendChild(checkbox);
    return span;
  }

  eq(other: TaskMarkerWidget) {
    return other.checked === this.checked;
  }
}

export class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly exists: boolean,
  ) {
    super();
  }

  toDOM() {
    const div = document.createElement('div');

    if (!this.exists) {
      div.className =
        'mycellia-image-error-container my-3 select-none p-3 rounded-lg border border-[var(--border-default)] bg-[var(--substrate-raised)] text-[var(--danger)] font-sans text-sm flex items-center gap-2';
      const errorMsg = document.createElement('span');
      errorMsg.textContent = `⚠️ Imagem não encontrada: `;
      const filenameSpan = document.createElement('span');
      filenameSpan.className = 'font-mono text-xs';
      filenameSpan.textContent = this.alt;
      errorMsg.appendChild(filenameSpan);
      div.appendChild(errorMsg);
      return div;
    }

    div.className = 'mycellia-image-container my-3 select-none flex flex-col items-start gap-1.5';

    const img = document.createElement('img');
    img.src = this.src;
    img.alt = this.alt;
    img.loading = 'lazy';
    img.className =
      'max-w-full max-h-[350px] rounded-lg border border-[var(--border-default)] object-contain shadow-lg hover:border-[var(--accent)] transition-all duration-200';

    const caption = document.createElement('span');
    caption.className = 'text-[10px] text-[var(--text-muted)] font-mono pl-1';
    caption.textContent = this.alt || 'Imagem';

    img.onerror = () => {
      img.style.display = 'none';
      caption.textContent = `⚠️ Erro ao carregar imagem: ${this.alt} (${this.src})`;
      caption.className =
        'text-[11px] text-[var(--danger)] font-mono pl-1 bg-[var(--danger-muted)]/5 px-2 py-1 rounded border border-[var(--danger)]/10';
    };

    div.appendChild(img);
    div.appendChild(caption);
    return div;
  }

  eq(other: ImageWidget) {
    return (
      other.src === this.src &&
      other.alt === this.alt &&
      other.exists === this.exists
    );
  }
}
