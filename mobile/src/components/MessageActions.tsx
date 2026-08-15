import React from 'react';
import { View, Text, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Sheet from './Sheet';
import { useTheme } from '../theme/ThemeProvider';
import { fonts } from '../theme/typography';

/**
 * Press and hold a message or a comment.
 *
 * Reply, edit and delete all belong to one line rather than to the box at the
 * bottom, and there is nowhere on a chat bubble to hang three buttons without
 * burying the words. A long press is where every messaging app puts this, so
 * it is where a coach will look for it.
 *
 * Edit and delete appear only on your own: a conversation is a record several
 * people are reading, and one of them rewriting another's words would make it
 * useless as one. That is enforced by the server too — this only decides what
 * to offer.
 */

export type MessageActionTarget = {
  /** What is being acted on, for the sheet's heading. */
  preview?: string | null;
  /** Whether the reader wrote it. */
  mine: boolean;
  /** Already taken back: nothing left to reply to, edit or remove. */
  deleted?: boolean;
};

export function MessageActions({
  target, onReply, onEdit, onDelete, onClose,
}: {
  target: MessageActionTarget | null;
  onReply?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { t } = useTheme();
  const { t: tr } = useTranslation();
  const [confirming, setConfirming] = React.useState(false);

  // A fresh sheet asks again. Without this, opening it a second time could
  // land straight on the confirmation for a different message.
  React.useEffect(() => { if (!target) setConfirming(false); }, [target]);

  if (!target) return null;
  const canEdit = target.mine && !target.deleted && !!onEdit;
  const canDelete = target.mine && !target.deleted && !!onDelete;
  const canReply = !target.deleted && !!onReply;

  const row = (icon: any, label: string, onPress: () => void, danger = false) => (
    <TouchableOpacity
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: 12,
        paddingVertical: 14, paddingHorizontal: 4,
        borderBottomWidth: 1, borderBottomColor: t.line,
      }}
    >
      <Ionicons name={icon} size={18} color={danger ? t.negative : t.ink} />
      <Text style={{ color: danger ? t.negative : t.ink, fontSize: 15, fontFamily: fonts[600] }}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <Sheet visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.scrim, justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: t.sheet, borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: 20, paddingBottom: Platform.OS === 'ios' ? 34 : 20,
          maxWidth: 520, width: '100%', alignSelf: 'center',
        }}>
          {!!target.preview && (
            <Text numberOfLines={2} style={{ color: t.muted, fontSize: 12.5, marginBottom: 10 }}>
              {target.preview}
            </Text>
          )}

          {confirming ? (
            <>
              <Text style={{ color: t.ink, fontSize: 16, fontFamily: fonts[800], marginBottom: 6 }}>
                {tr('msgActions.deleteTitle')}
              </Text>
              <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19, marginBottom: 16 }}>
                {tr('msgActions.deleteBody')}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TouchableOpacity
                  onPress={onClose}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10,
                           borderWidth: 1, borderColor: t.line }}
                >
                  <Text style={{ color: t.ink, fontFamily: fonts[700] }}>{tr('common.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => { onDelete?.(); onClose(); }}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10,
                           backgroundColor: t.negative }}
                >
                  <Text style={{ color: '#fff', fontFamily: fonts[700] }}>{tr('common.delete')}</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              {canReply && row('arrow-undo-outline', tr('msgActions.reply'),
                               () => { onReply?.(); onClose(); })}
              {canEdit && row('create-outline', tr('msgActions.edit'),
                              () => { onEdit?.(); onClose(); })}
              {canDelete && row('trash-outline', tr('common.delete'),
                                () => setConfirming(true), true)}
              <TouchableOpacity onPress={onClose} style={{ paddingVertical: 14, alignItems: 'center' }}>
                <Text style={{ color: t.muted, fontSize: 15, fontFamily: fonts[600] }}>
                  {tr('common.cancel')}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Sheet>
  );
}

/** The line above the composer while you are answering or rewriting something. */
export function ComposingBanner({
  label, preview, onCancel,
}: { label: string; preview?: string | null; onCancel: () => void }) {
  const { t } = useTheme();
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingHorizontal: 12, paddingVertical: 8,
      borderTopWidth: 1, borderTopColor: t.line, backgroundColor: t.card,
    }}>
      <View style={{ width: 3, alignSelf: 'stretch', backgroundColor: t.accent, borderRadius: 2 }} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: t.accent, fontSize: 11.5, fontFamily: fonts[700] }}>{label}</Text>
        {!!preview && (
          <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>{preview}</Text>
        )}
      </View>
      <TouchableOpacity onPress={onCancel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="close" size={18} color={t.muted} />
      </TouchableOpacity>
    </View>
  );
}
