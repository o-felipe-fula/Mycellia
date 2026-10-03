import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../store/appStore';
import { isMap, isSeq, Pair } from 'yaml';
import {
  Plus,
  Trash2,
  ChevronDown,
  Tags,
  Key,
  Type,
  ToggleLeft,
  ListPlus,
} from 'lucide-react';

export default function PropertiesPanel() {
  const { t } = useTranslation();
  const { activeNoteYamlDoc, updateActiveNoteFrontmatter } = useAppStore();
  const [isOpen, setIsOpen] = useState(false); // Collapsed by default
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newType, setNewType] = useState<'text' | 'boolean' | 'list'>('text');

  // Recupera todas as propriedades do Document
  const properties: { key: string; value: unknown }[] = [];
  if (activeNoteYamlDoc && isMap(activeNoteYamlDoc.contents)) {
    activeNoteYamlDoc.contents.items.forEach((item) => {
      if (item && item instanceof Pair && item.key !== null && item.key !== undefined) {
        const keyStr = item.key.toString();
        const val = activeNoteYamlDoc.get(keyStr);
        properties.push({ key: keyStr, value: val });
      }
    });
  }

  const handleUpdateValue = (key: string, val: unknown) => {
    updateActiveNoteFrontmatter((doc) => {
      doc.set(key, val);
    });
  };

  const handleRenameKey = (oldKey: string, newKeyName: string) => {
    if (!newKeyName || oldKey === newKeyName) return;
    updateActiveNoteFrontmatter((doc) => {
      const val = doc.get(oldKey);
      doc.delete(oldKey);
      doc.set(newKeyName, val);
    });
  };

  const handleDeleteProperty = (key: string) => {
    updateActiveNoteFrontmatter((doc) => {
      doc.delete(key);
    });
  };

  const handleAddProperty = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;

    let parsedVal: unknown = newValue;
    if (newType === 'boolean') {
      parsedVal = newValue.toLowerCase() === 'true' || newValue === '1';
    } else if (newType === 'list') {
      parsedVal = newValue
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    updateActiveNoteFrontmatter((doc) => {
      doc.set(newKey.trim(), parsedVal);
    });

    setNewKey('');
    setNewValue('');
  };

  const handleAddListTag = (key: string, tagValue: string, currentList: unknown[]) => {
    if (!tagValue.trim()) return;
    const newList = [...currentList, tagValue.trim()];
    handleUpdateValue(key, newList);
  };

  const handleRemoveListTag = (key: string, index: number, currentList: unknown[]) => {
    const newList = currentList.filter((_, i) => i !== index);
    handleUpdateValue(key, newList);
  };

  const renderValueField = (key: string, value: unknown) => {
    // Array / Lista
    if (Array.isArray(value) || (value && typeof value === 'object' && isSeq(value))) {
      const listArray: unknown[] = Array.isArray(value)
        ? value
        : value.toJSON
          ? (value.toJSON() as unknown[])
          : [];

      return (
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          {listArray.map((item, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-[var(--tag-muted)] text-[var(--tag)] text-[10px] border border-[var(--border-subtle)] font-mono"
            >
              {String(item)}
              <button
                type="button"
                onClick={() => handleRemoveListTag(key, idx, listArray)}
                className="hover:text-[var(--danger)] font-bold ml-0.5 focus:outline-none cursor-pointer"
              >
                ×
              </button>
            </span>
          ))}
          <input
            type="text"
            placeholder={t('properties.addTagPlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const target = e.target as HTMLInputElement;
                handleAddListTag(key, target.value, listArray);
                target.value = '';
              }
            }}
            className="flex-1 min-w-[60px] bg-transparent border-0 focus:ring-0 text-xs text-[var(--text-primary)] p-0.5 placeholder-[var(--text-muted)] focus:outline-none font-mono"
          />
        </div>
      );
    }

    // Boolean
    if (typeof value === 'boolean') {
      return (
        <div className="flex items-center flex-1">
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => handleUpdateValue(key, e.target.checked)}
            className="w-3.5 h-3.5 rounded border-[var(--border-default)] bg-transparent text-[var(--accent)] focus:ring-offset-0 focus:ring-0 cursor-pointer"
          />
          <span className="text-[10px] text-[var(--text-muted)] font-mono ml-2 select-none">
            {value ? 'true' : 'false'}
          </span>
        </div>
      );
    }

    // Texto/Outros
    return (
      <input
        type="text"
        value={String(value ?? '')}
        onChange={(e) => handleUpdateValue(key, e.target.value)}
        className="flex-1 bg-transparent border-0 focus:ring-0 text-xs text-[var(--text-primary)] p-0.5 focus:outline-none font-mono"
      />
    );
  };

  // 1. COLLAPSED VIEW
  if (!isOpen) {
    if (properties.length === 0) {
      return (
        <div className="flex select-none">
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="inline-flex items-center gap-1 text-[var(--text-muted)] hover:text-[var(--accent)] text-[11px] font-medium py-1 px-2 rounded border border-dashed border-[var(--border-default)] hover:border-[var(--accent)] transition-all cursor-pointer bg-transparent"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('properties.addProperties')}</span>
          </button>
        </div>
      );
    }

    return (
      <div
        onClick={() => setIsOpen(true)}
        className="w-full border border-[var(--border-default)] bg-[var(--substrate-surface)] hover:bg-[var(--substrate-raised)] rounded-lg p-2 flex items-center gap-2 cursor-pointer transition-all select-none text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <Tags className="w-3.5 h-3.5 text-[var(--accent)]" />
        <span className="font-semibold text-[10px] uppercase tracking-wider">{t('properties.title')}</span>
        <div className="flex flex-wrap items-center gap-1.5 ml-2 overflow-hidden max-h-6">
          {properties.map(({ key, value }) => {
            const displayVal = Array.isArray(value)
              ? value.join(', ')
              : String(value);
            return (
              <span
                key={key}
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-[var(--substrate-raised)] text-[10px] font-mono text-[var(--text-secondary)] border border-[var(--border-subtle)]"
              >
                {key}: {displayVal}
              </span>
            );
          })}
        </div>
      </div>
    );
  }

  // 2. EXPANDED VIEW
  return (
    <div className="w-full border border-[var(--border-default)] bg-[var(--substrate-raised)] rounded-xl p-3.5 text-xs transition-all duration-200">
      <div
        onClick={() => setIsOpen(false)}
        className="flex items-center justify-between cursor-pointer select-none text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <div className="flex items-center gap-2 font-display font-semibold tracking-wide text-xs">
          <Tags className="w-4 h-4 text-[var(--accent)] animate-pulse" />
          <span>{t('properties.header')} {properties.length > 0 && `(${properties.length})`}</span>
        </div>
        <ChevronDown className="w-4 h-4" />
      </div>

      <div className="mt-3.5 space-y-3.5 animate-in fade-in duration-200">
        {/* List of existing properties */}
        {properties.length === 0 ? (
          <div className="text-[11px] text-[var(--text-muted)] italic py-1 pl-1">
            {t('properties.empty')}
          </div>
        ) : (
          <div className="border border-[var(--border-default)] rounded-lg overflow-hidden bg-[var(--substrate-void)] divide-y divide-[var(--border-subtle)]">
            {properties.map(({ key, value }) => (
              <div
                key={key}
                className="flex items-center group p-1.5 hover:bg-[var(--substrate-surface)] transition-colors"
              >
                {/* Property Key Label / Editor */}
                <div className="w-32 flex-shrink-0 flex items-center gap-1.5 border-r border-[var(--border-default)] pr-2">
                  <Key className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  <input
                    type="text"
                    defaultValue={key}
                    onBlur={(e) => handleRenameKey(key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    className="w-full bg-transparent border-0 focus:ring-0 text-xs font-semibold text-[var(--text-secondary)] focus:text-[var(--text-primary)] p-0.5 focus:outline-none font-mono truncate"
                    title={t('properties.renameTooltip')}
                  />
                </div>

                {/* Property Value Editor */}
                <div className="flex-1 min-w-0 pl-3.5 pr-2 flex items-center">
                  {renderValueField(key, value)}
                </div>

                {/* Remove Button */}
                <button
                  type="button"
                  onClick={() => handleDeleteProperty(key)}
                  className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 focus:outline-none cursor-pointer"
                  title={t('properties.deleteTooltip')}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Form to add a new property */}
        <form
          onSubmit={handleAddProperty}
          className="flex flex-wrap items-center gap-2 border-t border-[var(--border-default)] pt-3.5"
        >
          <div className="flex items-center gap-1 border border-[var(--border-default)] rounded-lg bg-[var(--substrate-void)] px-2 py-1 min-w-[120px] flex-1">
            <Key className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder={t('properties.keyPlaceholder')}
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="bg-transparent border-0 focus:ring-0 text-xs text-[var(--text-primary)] p-0 w-full focus:outline-none font-mono"
            />
          </div>

          <div className="flex items-center gap-1 border border-[var(--border-default)] rounded-lg bg-[var(--substrate-void)] px-2 py-1 flex-[2] min-w-[180px]">
            {newType === 'text' && <Type className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
            {newType === 'boolean' && (
              <ToggleLeft className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            )}
            {newType === 'list' && <ListPlus className="w-3.5 h-3.5 text-[var(--text-muted)]" />}
            <input
              type="text"
              placeholder={
                newType === 'list'
                  ? t('properties.listPlaceholder')
                  : newType === 'boolean'
                    ? 'true / false'
                    : t('properties.valuePlaceholder')
              }
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="bg-transparent border-0 focus:ring-0 text-xs text-[var(--text-primary)] p-0 w-full focus:outline-none font-mono"
            />
          </div>

          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as 'text' | 'boolean' | 'list')}
            className="bg-[var(--substrate-surface)] border border-[var(--border-default)] rounded-lg text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] px-2.5 py-1 focus:outline-none cursor-pointer font-mono"
          >
            <option value="text">{t('properties.typeText')}</option>
            <option value="boolean">{t('properties.typeBoolean')}</option>
            <option value="list">{t('properties.typeList')}</option>
          </select>

          <button
            type="submit"
            disabled={!newKey.trim()}
            className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-[var(--accent)] to-[var(--tag)] text-[var(--accent-contrast)] font-bold text-xs hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer transition-all duration-200"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('properties.add')}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
