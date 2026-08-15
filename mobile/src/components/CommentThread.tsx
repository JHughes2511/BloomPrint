import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme/ThemeProvider';
import { ThemeTokens } from '../theme/tokens';
import { fonts } from '../theme/typography';
import { MessageActions } from './MessageActions';

export type ThreadComment = {
  id: number;
  parent_id?: number | null;
  author_name?: string;
  text: string;
  created_at: string;
  /** Rewritten since it was posted. */
  edited?: boolean;
  /** Taken back. It keeps its place so the replies under it still read. */
  deleted?: boolean;
};

/**
 * Renders comments as nested threads (full depth). Each comment has a Reply
 * action that opens an inline box; onReply(parentId, text) posts the reply.
 */
export default function CommentThread({
  comments,
  onReply,
  accent,
  mine,
  onEdit,
  onDelete,
}: {
  comments: ThreadComment[];
  onReply: (parentId: number, text: string) => Promise<void>;
  accent?: string;
  /** Whether the reader wrote this one — decides what a long press offers. */
  mine?: (c: ThreadComment) => boolean;
  onEdit?: (id: number, text: string) => Promise<void>;
  onDelete?: (id: number) => Promise<void>;
}) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const s = makeStyles(t);
  const acc = accent ?? t.accent;
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  // The comment a long press opened the menu on, and the one being rewritten.
  const [acting, setActing] = useState<ThreadComment | null>(null);
  const [editing, setEditing] = useState<ThreadComment | null>(null);
  const [editText, setEditText] = useState('');

  const byParent = useMemo(() => {
    const map: Record<string, ThreadComment[]> = {};
    comments.forEach(c => {
      const key = c.parent_id == null ? 'root' : String(c.parent_id);
      (map[key] = map[key] || []).push(c);
    });
    return map;
  }, [comments]);

  const submit = async (parentId: number) => {
    if (!replyText.trim()) return;
    setSubmitting(true);
    try {
      await onReply(parentId, replyText.trim());
      setReplyText('');
      setReplyTo(null);
    } finally {
      setSubmitting(false);
    }
  };

  const saveEdit = async () => {
    if (!editing || !editText.trim() || !onEdit) return;
    setSubmitting(true);
    try {
      await onEdit(editing.id, editText.trim());
      setEditing(null);
      setEditText('');
    } finally {
      setSubmitting(false);
    }
  };

  const renderLevel = (parentKey: string, depth: number): React.ReactNode[] => {
    const items = byParent[parentKey] ?? [];
    return items.map(c => {
      const childCount = (byParent[String(c.id)] ?? []).length;
      const isCollapsed = !!collapsed[c.id];
      return (
        <View key={c.id} style={[depth > 0 && { marginLeft: 14, borderLeftWidth: 2, borderLeftColor: t.line, paddingLeft: 10 }]}>
          <TouchableOpacity
            activeOpacity={0.9}
            onLongPress={() => setActing(c)}
            delayLongPress={350}
            {...(Platform.OS === 'web'
              ? { onContextMenu: (e: any) => { e.preventDefault(); setActing(c); } } as any
              : null)}
            style={s.card}
          >
            <View style={s.head}>
              <Text style={[s.author, { color: acc }]}>
                {c.author_name || tr('components.commentThread.unknown')}
                {c.edited && !c.deleted ? ` · ${tr('msgActions.edited')}` : ''}
              </Text>
              <Text style={s.date}>{new Date(c.created_at).toLocaleDateString()}</Text>
            </View>
            {editing?.id === c.id ? (
              <View style={s.replyRow}>
                <TextInput
                  style={s.input}
                  value={editText}
                  onChangeText={setEditText}
                  autoFocus
                  multiline
                />
                <TouchableOpacity style={s.sendBtn} onPress={saveEdit}
                                  disabled={submitting || !editText.trim()}>
                  {submitting ? <ActivityIndicator color={t.ctaText} size="small" />
                              : <Ionicons name="checkmark" size={20} color={t.ctaText} />}
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={[s.text, c.deleted && { fontStyle: 'italic', opacity: 0.7 }]}>
                {c.deleted ? tr('msgActions.deleted') : c.text}
              </Text>
            )}
            <View style={s.actionsRow}>
              <TouchableOpacity onPress={() => { setReplyTo(replyTo === c.id ? null : c.id); setReplyText(''); }} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Text style={[s.replyLink, { color: acc }]}>{replyTo === c.id ? tr('common.cancel') : tr('components.commentThread.reply')}</Text>
              </TouchableOpacity>
              {childCount > 0 && (
                <TouchableOpacity onPress={() => setCollapsed(prev => ({ ...prev, [c.id]: !prev[c.id] }))} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Text style={[s.replyLink, { color: t.muted }]}>
                    {isCollapsed ? tr('components.commentThread.showReplies', { count: childCount }) : tr('components.commentThread.hideReplies')}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableOpacity>
          {replyTo === c.id && (
            <View style={s.replyRow}>
              <TextInput
                style={s.input}
                placeholder={tr('components.commentThread.replyPlaceholder', { name: c.author_name || tr('components.commentThread.commentFallback') })}
                placeholderTextColor={t.muted2}
                value={replyText}
                onChangeText={setReplyText}
                autoFocus
                multiline
              />
              <TouchableOpacity style={s.sendBtn} onPress={() => submit(c.id)} disabled={submitting || !replyText.trim()}>
                {submitting ? <ActivityIndicator color={t.ctaText} size="small" /> : <Ionicons name="arrow-up" size={20} color={t.ctaText} />}
              </TouchableOpacity>
            </View>
          )}
          {!isCollapsed && renderLevel(String(c.id), depth + 1)}
        </View>
      );
    });
  };

  return (
    <View>
      {renderLevel('root', 0)}
      <MessageActions
        target={acting ? {
          preview: acting.deleted ? tr('msgActions.deleted') : acting.text,
          mine: mine ? mine(acting) : false,
          deleted: !!acting.deleted,
        } : null}
        onReply={() => { setReplyTo(acting!.id); setReplyText(''); setEditing(null); }}
        onEdit={onEdit ? () => { setEditing(acting); setEditText(acting?.text ?? ''); } : undefined}
        onDelete={onDelete ? () => { if (acting) void onDelete(acting.id); } : undefined}
        onClose={() => setActing(null)}
      />
    </View>
  );
}

const makeStyles = (t: ThemeTokens) => StyleSheet.create({
  card: { backgroundColor: t.card, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: t.cardBorder },
  head: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  author: { fontSize: 12, fontFamily: fonts[700] },
  date: { color: t.muted, fontSize: 11 },
  text: { color: t.inkSoft, fontSize: 13, lineHeight: 19 },
  actionsRow: { flexDirection: 'row', gap: 16, marginTop: 8 },
  replyLink: { fontSize: 12, fontFamily: fonts[700] },
  replyRow: { flexDirection: 'row', gap: 8, marginBottom: 10, alignItems: 'flex-end' },
  input: { flex: 1, backgroundColor: t.chip, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: t.ink, fontSize: 13.5, borderWidth: 1, borderColor: t.line, minHeight: 40 },
  sendBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: t.ctaBg,
             alignItems: 'center', justifyContent: 'center' },
});
