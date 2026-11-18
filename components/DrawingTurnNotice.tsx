'use client';
import { useLanguage } from './LanguageProvider';

import { X } from 'lucide-react';
import './drawing-turn-notice.css';

type Props = {
  message: string;
  onDismiss: () => void;
};

export default function DrawingTurnNotice({ message, onDismiss }: Props) {
 const {t}=useLanguage();
  if (!message.trim()) return null;

  return <div className="drawing-turn-notice" role="status" aria-live="polite" aria-atomic="true">
    <span className="drawing-turn-notice__message">{t(message)}</span>
    <button
      type="button"
      className="drawing-turn-notice__dismiss"
      onClick={onDismiss}
      aria-label={t("放下这句，继续说")}
    >
      <X size={14} strokeWidth={1.6} aria-hidden="true" />
    </button>
  </div>;
}
