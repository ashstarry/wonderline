'use client';

import { BookOpen, Heart } from 'lucide-react';
import './studio-discover.css';

type Language = 'en' | 'zh';

const copy = {
  en: {
    library: 'Your collection',
    companions: 'My companions',
    companionsHint: 'Bring a saved friend into this story',
    picturebook: 'Picturebook',
    picturebookHint: 'Your saved pictures and stories',
    actions: 'Story tools',
    keep: 'Keep a character',
    keepHint: 'Choose a character on the page and give them a name',
    picking: 'Choose on the page',
    pickingHint: 'Click a character on the page, or click here to cancel',
    emptyHint: 'Draw a character first, then keep them for another story',
  },
  zh: {
    library: '我的收藏',
    companions: '我的伙伴',
    companionsHint: '让保存的伙伴来到这次的故事里',
    picturebook: '画册',
    picturebookHint: '看看收藏的画面和故事',
    actions: '创作小帮手',
    keep: '留下角色',
    keepHint: '直接点选画中的角色，给它起个名字',
    picking: '点选画中的角色',
    pickingHint: '点选一个角色，再点这里可以取消',
    emptyHint: '先画一个角色，就能把它留下来一起讲故事',
  },
} as const;

export type StudioLibraryNavProps = {
  language: Language;
  onCompanions: () => void;
  onPicturebook: () => void;
};

/** Collection destinations stay in navigation, away from the live microphone. */
export function StudioLibraryNav({ language, onCompanions, onPicturebook }: StudioLibraryNavProps) {
  const text = copy[language];
  return <nav className="studio-library-nav" aria-label={text.library}>
    <button type="button" onClick={onCompanions} title={text.companionsHint} aria-haspopup="dialog">
      <Heart size={16} strokeWidth={1.65} aria-hidden="true"/><span>{text.companions}</span>
    </button>
    <button type="button" onClick={onPicturebook} title={text.picturebookHint} aria-haspopup="dialog">
      <BookOpen size={16} strokeWidth={1.65} aria-hidden="true"/><span>{text.picturebook}</span>
    </button>
  </nav>;
}

export type StudioCreationActionsProps = {
  language: Language;
  picking: boolean;
  canPick: boolean;
  onPick: () => void;
};

/** These are immediate actions on the current story, with no intermediate menu. */
export function StudioCreationActions({ language, picking, canPick, onPick }: StudioCreationActionsProps) {
  const text = copy[language];
  return <div className="studio-creation-actions" role="group" aria-label={text.actions}>
    <button type="button" className={`studio-creation-action${picking ? ' is-picking' : ''}`} onClick={onPick}
      disabled={!canPick && !picking} aria-pressed={picking}
      title={picking ? text.pickingHint : canPick ? text.keepHint : text.emptyHint}>
      <Heart size={16} strokeWidth={1.65} aria-hidden="true"/><span>{picking ? text.picking : text.keep}</span>
    </button>
  </div>;
}
