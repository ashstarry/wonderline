import {createRoot} from 'react-dom/client';
import Home from '../app/page';
import Examples from '../app/examples/page';
import Experiments from '../app/experiments/page';
import {LanguageProvider} from '../components/LanguageProvider';
import '../app/globals.css';
const view=new URLSearchParams(location.search).get('view');
createRoot(document.getElementById('root')!).render(<LanguageProvider>{view==='examples'?<Examples/>:view==='experiments'?<Experiments/>:<Home/>}</LanguageProvider>);
