import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('../',import.meta.url));
export default defineConfig({
 root:project+'static-frontend',base:'./',publicDir:false,
 resolve:{alias:{'@':project}},define:{__WONDERLINE_PAGES__:'true'},
 plugins:[{name:'pages-font-url',enforce:'pre',transform(code,id){if(id.endsWith('/app/globals.css'))return code.replaceAll("/fonts/LXGWMarkerGothic-Regular.ttf","./LXGWMarkerGothic-Regular.ttf");}}],
 build:{outDir:project+'work/github-pages',emptyOutDir:true,assetsDir:'',sourcemap:false},
});
