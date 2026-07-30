import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FilePlus, FolderPlus, Edit, Trash2 } from 'lucide-react';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onCreateFile: () => void;
  onCreateFolder: () => void;
  onRename: () => void;
  onDelete: () => void;
}

export default function ContextMenu({
  x,
  y,
  onClose,
  onCreateFile,
  onCreateFolder,
  onRename,
  onDelete,
}: ContextMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou apertar Esc
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Ajusta a posição para não transbordar da tela
  const menuWidth = 180;
  const menuHeight = 160;

  let adjustedX = x;
  let adjustedY = y;

  if (x + menuWidth > window.innerWidth) {
    adjustedX = window.innerWidth - menuWidth - 10;
  }
  if (y + menuHeight > window.innerHeight) {
    adjustedY = window.innerHeight - menuHeight - 10;
  }

  // Previne clique com botão direito no próprio menu
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  return createPortal(
    <div
      ref={menuRef}
      onContextMenu={handleContextMenu}
      style={{
        top: adjustedY,
        left: adjustedX,
        width: menuWidth,
      }}
      className="fixed z-50 rounded-lg shadow-xl border border-[var(--border-default)] glass-panel bg-[var(--substrate-overlay)] py-1.5 flex flex-col text-sm select-none animate-in fade-in zoom-in-95 duration-100"
    >
      <button
        onClick={() => {
          onCreateFile();
          onClose();
        }}
        className="flex items-center gap-2.5 px-3 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--substrate-raised)] text-left cursor-pointer transition-colors"
      >
        <FilePlus className="w-4 h-4 text-[var(--accent)]" />
        <span>{t('fileTree.menuNewNote')}</span>
      </button>

      <button
        onClick={() => {
          onCreateFolder();
          onClose();
        }}
        className="flex items-center gap-2.5 px-3 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--substrate-raised)] text-left cursor-pointer transition-colors"
      >
        <FolderPlus className="w-4 h-4 text-[var(--tag)]" />
        <span>{t('fileTree.menuNewFolder')}</span>
      </button>

      <div className="h-[1px] bg-[var(--border-subtle)] my-1" />

      <button
        onClick={() => {
          onRename();
          onClose();
        }}
        className="flex items-center gap-2.5 px-3 py-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--substrate-raised)] text-left cursor-pointer transition-colors"
      >
        <Edit className="w-4 h-4 text-[var(--accent)]" />
        <span>{t('fileTree.menuRename')}</span>
      </button>

      <button
        onClick={() => {
          onDelete();
          onClose();
        }}
        className="flex items-center gap-2.5 px-3 py-2 text-[var(--danger)] hover:bg-[var(--danger-muted)] hover:text-[var(--danger)] text-left cursor-pointer transition-colors"
      >
        <Trash2 className="w-4 h-4" />
        <span>{t('fileTree.menuDelete')}</span>
      </button>
    </div>,
    document.body,
  );
}
