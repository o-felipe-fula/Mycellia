import React, { useState } from 'react';
import { useAppStore, FileNode } from '../store/appStore';
import { Folder, FolderOpen, FileText, Image, File, ChevronDown, ChevronRight } from 'lucide-react';
import ContextMenu from './ContextMenu';

interface FileTreeProps {
  node: FileNode;
}

export default function FileTree({ node }: FileTreeProps) {
  const { createItem, renameItem, deleteItem, openTab, activeTab, openInDefaultApp } = useAppStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ [node.path]: true });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; target: FileNode } | null>(
    null,
  );

  const toggleExpand = (path: string) => {
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const isImageFile = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase();
    return ext && ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext);
  };

  const getFileIcon = (item: FileNode) => {
    if (item.is_dir) {
      return expanded[item.path] ? (
        <FolderOpen className="w-4 h-4 text-[var(--accent-dim)] flex-shrink-0" />
      ) : (
        <Folder className="w-4 h-4 text-[var(--accent-dim)] flex-shrink-0" />
      );
    }
    if (item.name.endsWith('.md')) {
      return <FileText className="w-4 h-4 text-[var(--text-secondary)] flex-shrink-0" />;
    }
    if (isImageFile(item.name)) {
      return <Image className="w-4 h-4 text-[var(--tag)] flex-shrink-0" />;
    }
    return <File className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" />;
  };

  const handleNodeClick = (e: React.MouseEvent, item: FileNode) => {
    e.stopPropagation();
    if (item.is_dir) {
      toggleExpand(item.path);
    } else {
      if (item.name.toLowerCase().endsWith('.md')) {
        openTab(item.path);
      } else {
        openInDefaultApp(item.path);
      }
    }
  };

  const handleNodeContextMenu = (e: React.MouseEvent, item: FileNode) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      target: item,
    });
  };

  // Funções disparadas pelas ações do Menu de Contexto
  const handleCreateFile = async (target: FileNode) => {
    const parentPath = target.is_dir
      ? target.path
      : target.path.substring(0, target.path.lastIndexOf('\\'));
    const name = prompt('Digite o nome da nova nota (ex: Minha Nota):');
    if (name) {
      try {
        const fullName = name.endsWith('.md') ? name : `${name}.md`;
        await createItem(parentPath, fullName, false);
      } catch (err) {
        alert(`Erro ao criar nota: ${err}`);
      }
    }
  };

  const handleCreateFolder = async (target: FileNode) => {
    const parentPath = target.is_dir
      ? target.path
      : target.path.substring(0, target.path.lastIndexOf('\\'));
    const name = prompt('Digite o nome da nova pasta:');
    if (name) {
      try {
        await createItem(parentPath, name, true);
        // Garante que a pasta pai esteja expandida
        setExpanded((prev) => ({ ...prev, [parentPath]: true }));
      } catch (err) {
        alert(`Erro ao criar pasta: ${err}`);
      }
    }
  };

  const handleRename = async (target: FileNode) => {
    const name = prompt('Digite o novo nome:', target.name.replace('.md', ''));
    if (name && name !== target.name) {
      try {
        await renameItem(target.path, name);
      } catch (err) {
        alert(`Erro ao renomear: ${err}`);
      }
    }
  };

  const handleDelete = async (target: FileNode) => {
    const confirmDelete = confirm(`Deseja mover "${target.name}" para a lixeira do sistema?`);
    if (confirmDelete) {
      try {
        await deleteItem(target.path);
      } catch (err) {
        alert(`Erro ao excluir: ${err}`);
      }
    }
  };

  const renderNode = (item: FileNode, depth = 0) => {
    const isExpanded = expanded[item.path];
    const isSelected = activeTab === item.path;

    return (
      <div key={item.path} className="flex flex-col">
        {/* Linha do nó */}
        <div
          onClick={(e) => handleNodeClick(e, item)}
          onContextMenu={(e) => handleNodeContextMenu(e, item)}
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
          className={`flex items-center gap-1.5 py-1.5 pr-2 text-xs rounded-md cursor-pointer transition-colors group ${
            isSelected
              ? 'bg-[var(--accent-muted)] text-[var(--text-primary)] border-l-2 border-[var(--accent)]'
              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--substrate-raised)]'
          }`}
        >
          {/* Chevron indicador apenas para pastas */}
          <div className="w-3.5 h-3.5 flex items-center justify-center">
            {item.is_dir ? (
              isExpanded ? (
                <ChevronDown className="w-3 h-3 text-[var(--text-muted)]" />
              ) : (
                <ChevronRight className="w-3 h-3 text-[var(--text-muted)]" />
              )
            ) : null}
          </div>

          {/* Ícone */}
          {getFileIcon(item)}

          {/* Nome */}
          <span className="truncate flex-1">{item.name}</span>
        </div>

        {/* Filhos se for pasta expandida */}
        {item.is_dir && isExpanded && item.children && (
          <div className="flex flex-col">
            {item.children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-full overflow-y-auto pr-1">
      {renderNode(node)}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onCreateFile={() => handleCreateFile(contextMenu.target)}
          onCreateFolder={() => handleCreateFolder(contextMenu.target)}
          onRename={() => handleRename(contextMenu.target)}
          onDelete={() => handleDelete(contextMenu.target)}
        />
      )}
    </div>
  );
}
