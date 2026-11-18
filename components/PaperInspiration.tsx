'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { RotateCw, X } from 'lucide-react';
import './paper-inspiration.css';

type Language = 'en' | 'zh';
type Drawing = 'cloud' | 'bear' | 'moon' | 'whale' | 'door' | 'kite' | 'journey';
type PaperIdea = { drawing: Drawing; en: string; zh: string; followup: Record<Language, string> };

/** Local invitations, deliberately separate from the scene and drawing prompts. */
export const PAPER_IDEAS: readonly (readonly PaperIdea[])[] = [
  [
    { drawing: 'cloud', en: 'Who lives inside a cloud?', zh: '谁住在云朵里面？', followup: { en: 'What do they look like? Do they have a favourite keepsake?', zh: '这位住客长什么样？有没有心爱的小宝贝？' } },
    { drawing: 'whale', en: 'What if a whale could fly?', zh: '如果鲸鱼会飞呢？', followup: { en: 'What are the whale’s fins like? Could they sparkle?', zh: '鲸鱼的鳍像什么？会不会闪闪发光？' } },
    { drawing: 'door', en: 'What would your tiny door look like?', zh: '你的小门会是什么样子？', followup: { en: 'What is the handle like? Any little patterns on the door?', zh: '门把手会像什么？门上有没有小小的花纹？' } },
  ],
  [
    { drawing: 'bear', en: 'What if a bear had wings?', zh: '如果小熊长出了翅膀……', followup: { en: 'What are the bear’s wings like? Could they be fluffy?', zh: '小熊的翅膀像什么？会不会毛茸茸的？' } },
    { drawing: 'kite', en: 'Who is following that kite?', zh: '谁在追着风筝跑？', followup: { en: 'Paws, feet, or little wheels? What makes them so speedy?', zh: '它长着脚、爪子，还是小轮子？怎么跑得这么快？' } },
    { drawing: 'journey', en: 'Who packed a very tiny suitcase?', zh: '谁收拾了小小的行李箱？', followup: { en: 'What is the little traveler wearing? Any tiny freckles?', zh: '小旅客穿着什么？脸上有没有小雀斑？' } },
  ],
  [
    { drawing: 'moon', en: 'What flower would you grow on the moon?', zh: '一朵怎样的花，会开在月亮上？', followup: { en: 'What are the petals like? Could they glow a little?', zh: '花瓣像什么？会不会偷偷发光？' } },
    { drawing: 'cloud', en: 'What would a cloud keep in its pocket?', zh: '云朵的口袋里，藏着什么？', followup: { en: 'What is the little treasure like? Does it twinkle or wiggle?', zh: '小宝贝长什么样？会闪光，还是会扭动？' } },
    { drawing: 'moon', en: 'Who is having a picnic on the moon?', zh: '谁在月亮上野餐？', followup: { en: 'Who is holding the picnic basket? What are they wearing?', zh: '谁抱着野餐篮？今天穿了什么特别的衣服？' } },
  ],
] as const;

export function paperIdeasFor(round: number, language: Language, companionName?: string | null) {
  const name = companionName?.trim();
  const index = Number.isFinite(round) ? Math.max(0, Math.floor(round)) : 0;
  return PAPER_IDEAS.map((lane, position) => {
    if (position === 1 && name) {
      const invitations = language === 'zh'
        ? [`${name}今天会是什么样子？`, `${name}会发现什么小秘密？`, `谁会成为${name}的新朋友？`]
        : [`What is ${name} like today?`, `What might ${name} discover?`, `Who could be ${name}’s new friend?`];
      const followups = language === 'zh'
        ? ['它今天是什么心情？想戴一顶怎样的帽子？', '这件宝贝会发光吗？像不像什么熟悉的东西？', '新朋友长什么样？有什么特别的小本领？']
        : ['How are they feeling today? What hat might they wear?', 'Could the treasure glow? What does its shape remind you of?', 'What does the new friend look like? Any special little talents?'];
      return { drawing: 'journey' as const, text: invitations[index % invitations.length], followup: followups[index % followups.length] };
    }
    const idea = lane[index % lane.length];
    return { drawing: idea.drawing, text: idea[language], followup: idea.followup[language] };
  });
}

const copy = {
  en: { title: 'What if…', label: 'A little inspiration', shuffle: 'A little more wonder', close: 'Let the page be blank', hint: 'A little wonder with a world of its own.' },
  zh: { title: '如果……', label: '一点小灵感', shuffle: '再想一点点', close: '让画纸留白', hint: '一个小小的主角，藏着一整个世界。' },
} as const;

/** Original, intentionally unfinished sketches: invitations, never painted scene objects. */
function Vignette({ kind }: { kind: Drawing }) {
  return <svg viewBox="0 0 220 160" className={`paper-idea-sketch paper-idea-sketch--${kind}`} aria-hidden="true" focusable="false">
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      {kind === 'cloud' && <>
        <path className="paper-sketch-wash wash-blue" d="M42 113C16 108 29 80 53 85C43 55 79 44 96 61C102 28 144 29 150 60C174 48 194 69 185 88C218 104 185 127 155 120C117 135 77 122 42 113Z"/>
        <path d="M40 111C21 106 30 82 50 86M50 86C45 60 74 47 93 64C102 31 139 32 149 60C172 49 194 70 182 89C204 95 197 118 177 119M49 119C85 126 124 127 159 121"/>
        <path className="paper-sketch-wash wash-peach" d="M91 91L90 72L108 57L127 72L127 96Z"/>
        <path d="M84 76L108 56L134 77M91 73L92 98M126 74L126 96M103 98L103 82L116 82L116 99"/>
        <path d="M109 114C111 126 97 133 101 145" strokeDasharray="2 7"/>
        <path className="paper-sketch-light" d="M158 32L160 24M173 38L179 34M35 62L29 57"/>
      </>}
      {kind === 'bear' && <>
        <path className="paper-sketch-wash wash-blue" d="M76 87C52 55 19 64 37 83C22 80 26 103 49 106L78 112M146 87C167 56 201 68 183 85C197 84 192 105 174 108L146 111"/>
        <path d="M77 86C52 57 27 67 37 81C23 80 29 102 52 104M145 86C169 59 193 67 183 84C197 84 191 103 172 106"/>
        <path className="paper-sketch-wash wash-honey" d="M87 91C70 76 78 57 90 62C101 52 118 51 131 61C145 56 155 73 139 88C154 118 137 135 110 136C84 137 69 119 87 91Z"/>
        <path d="M87 90C73 80 77 60 90 62M90 62C101 53 120 53 130 62C145 57 151 75 139 86M86 92C77 105 76 121 89 129M133 92C147 108 145 125 132 130M97 135C104 138 115 137 121 135"/>
        <path d="M92 85L92 87M128 85L128 87M105 94Q111 89 117 94L111 99Z"/>
        <path className="paper-sketch-light" d="M56 48L61 40M161 40L166 48M109 28L110 39M62 139Q49 141 44 133"/>
      </>}
      {kind === 'moon' && <>
        <path className="paper-sketch-wash wash-honey" d="M135 27C86 30 68 88 111 112C133 126 163 120 177 102C155 144 106 151 77 118C42 78 81 23 135 27Z"/>
        <path d="M133 26C90 28 70 76 100 103C121 123 156 123 176 102M176 102C156 143 107 149 77 118C44 80 78 26 123 26"/>
        <path d="M106 111C102 94 110 81 109 70M123 119C127 104 124 97 133 86M140 119L148 103"/>
        <path className="paper-sketch-wash wash-peach" d="M106 72C91 65 98 57 105 60C107 44 117 48 116 59C131 52 135 64 122 70C127 82 114 85 111 74Z"/>
        <path d="M106 72C94 67 98 57 106 61C109 48 119 51 116 61C130 55 134 67 121 70M124 99Q137 99 139 89Q126 88 124 99"/>
        <path d="M165 42L168 33L171 42L180 45L171 48L168 57L165 48L156 45Z" className="paper-sketch-light"/>
        <path d="M49 44L50 41M191 76L194 76"/>
      </>}
      {kind === 'whale' && <>
        <path className="paper-sketch-wash wash-blue" d="M41 85C42 58 71 51 99 60C128 67 132 100 163 92C174 84 171 66 186 63L184 91L203 83C199 106 179 118 157 113C110 125 69 125 49 105Z"/>
        <path d="M41 84C43 58 71 52 96 59C130 66 134 103 163 92C175 84 172 67 187 63L184 91L202 84C199 104 179 118 158 112M41 90C41 114 87 125 127 119"/>
        <path d="M61 80L62 82M50 92Q58 98 70 94M100 99Q117 105 111 121M72 55C70 42 75 39 80 43M72 54C65 42 60 47 61 51"/>
        <path className="paper-sketch-light" d="M34 135Q45 129 53 135M143 42Q152 35 164 41M172 137L190 133"/>
      </>}
      {kind === 'door' && <>
        <path className="paper-sketch-wash wash-sage" d="M41 127C51 90 71 64 101 50C130 38 163 47 177 77C189 102 176 120 173 130Z"/>
        <path className="paper-sketch-wash wash-peach" d="M94 128L94 83Q110 63 127 84L128 131Z"/>
        <path d="M95 130L93 86C94 67 125 66 128 84L129 131M101 125L102 84Q111 75 121 84L121 126M115 107L116 107"/>
        <path d="M39 130Q62 125 86 132M139 132L181 132M63 111L65 103L70 111M150 116L157 106L162 116M80 68L83 58" className="paper-sketch-light"/>
        <path d="M110 134C113 143 137 140 140 151" strokeDasharray="2 7"/>
        <path d="M161 46L163 38M175 52L181 48"/>
      </>}
      {kind === 'kite' && <>
        <path className="paper-sketch-wash wash-peach" d="M126 27L160 57L134 94L103 61Z"/>
        <path d="M126 27L159 57L134 94L103 61ZM126 27L134 94M104 60L159 57M134 94C151 112 116 113 132 127C138 132 140 139 131 146"/>
        <path className="paper-sketch-wash wash-blue" d="M141 108L153 106L151 116L140 109L132 118L128 108Z"/>
        <path d="M139 109L153 105L151 116L139 109L132 117L128 108Z"/>
        <path className="paper-sketch-light" d="M32 102C57 97 79 115 81 132M39 112C50 110 61 112 65 119M59 51L73 47M70 63L87 60"/>
        <path d="M168 24L174 23M184 74L193 78"/>
      </>}
      {kind === 'journey' && <>
        <path className="paper-sketch-wash wash-peach" d="M82 94L135 89L139 129L81 133Z"/>
        <path d="M81 96L133 90L138 128L82 132ZM96 93L96 83Q105 76 118 81L119 91M89 95L91 131M124 91L129 129"/>
        <path className="paper-sketch-wash wash-blue" d="M132 58C115 44 122 27 139 24C163 24 177 46 158 63C150 74 143 74 132 58Z"/>
        <path d="M139 24C120 26 117 46 132 59C142 75 155 67 164 52C176 33 151 19 139 24ZM146 68L143 75L151 74M147 75C157 86 134 88 139 101"/>
        <path className="paper-sketch-light" d="M43 138C60 127 68 143 77 139M151 138L169 133M184 124L187 121" strokeDasharray="2 7"/>
        <path d="M57 61L60 52L63 61L72 64L63 67L60 76L57 67L48 64Z" className="paper-sketch-light"/>
      </>}
    </g>
  </svg>;
}

export type PaperInspirationProps = {
  visible: boolean;
  language: Language;
  companionName?: string | null;
  reducedMotion?: boolean;
  overArtwork?: boolean;
  onDismiss: () => void;
};

export default function PaperInspiration({ visible, language, companionName, reducedMotion = false, overArtwork = false, onDismiss }: PaperInspirationProps) {
  const titleId = useId();
  const layer = useRef<HTMLElement>(null);
  const [round, setRound] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const text = copy[language];
  const ideas = paperIdeasFor(round, language, companionName);

  useEffect(() => {
    if (!visible) {
      setChosen(null);
      if (document.activeElement instanceof HTMLElement && layer.current?.contains(document.activeElement)) {
        document.activeElement.blur();
      }
    }
  }, [visible]);

  return <section id="paper-inspiration" ref={layer} className={`paper-inspiration${visible ? ' is-visible' : ''}${reducedMotion ? ' is-reduced-motion' : ''}${overArtwork ? ' is-over-artwork' : ''}`}
    aria-label={text.label} aria-hidden={!visible} inert={!visible} data-language={language}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); onDismiss(); }
      // A thought button uses Space normally, without toggling the microphone shortcut.
      if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
    }}>
    <div className="paper-inspiration-composition">
      <div className="paper-inspiration-heading"><span aria-hidden="true"/><h2 id={titleId}>{text.title}</h2><span aria-hidden="true"/></div>
      <div className="paper-ideas" role="group" aria-labelledby={titleId}>
        {ideas.map((idea, index) => <button key={`${round}-${index}`} type="button"
          className={`paper-idea paper-idea--${index}${chosen === index ? ' is-chosen' : ''}`}
          aria-label={idea.text} aria-pressed={chosen === index} aria-describedby={chosen === index ? `${titleId}-followup-${index}` : undefined} onClick={() => setChosen(chosen === index ? null : index)}>
          <Vignette kind={idea.drawing}/>
          <span className="paper-idea-question">{idea.text}</span>
          <span id={`${titleId}-followup-${index}`} className="paper-idea-whisper" aria-live="polite" aria-atomic="true">{chosen === index ? idea.followup : '\u00a0'}</span>
        </button>)}
      </div>
      <p className="paper-inspiration-note">{text.hint}</p>
      <div className="paper-inspiration-controls">
        <button type="button" onClick={() => { setRound(previous => previous + 1); setChosen(null); }}><RotateCw size={13} strokeWidth={1.5} aria-hidden="true"/><span>{text.shuffle}</span></button>
        <span aria-hidden="true"/>
        <button type="button" onClick={onDismiss} aria-label={text.close} title={text.close}><X size={16} strokeWidth={1.4} aria-hidden="true"/></button>
      </div>
    </div>
  </section>;
}
