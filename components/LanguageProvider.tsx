'use client';
import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
import {BRAND,LANGUAGE_KEY,readLanguage,translateUi,type Language} from '../lib/ui-language';
const LanguageContext=createContext({language:'en' as Language,setLanguage:(_language:Language)=>{},t:(source:string,values?:Record<string,string|number>)=>translateUi('en',source,values),brand:BRAND.en});
export function LanguageProvider({children,initialLanguage='en'}:{children:ReactNode;initialLanguage?:Language}){
 const [language,setCurrent]=useState<Language>(()=>readLanguage(initialLanguage));
 useEffect(()=>{try{setCurrent(readLanguage(localStorage.getItem(LANGUAGE_KEY)));}catch{/* English stays available without storage. */}},[]);
 const setLanguage=useCallback((next:Language)=>{const available=readLanguage(next);setCurrent(available);try{localStorage.setItem(LANGUAGE_KEY,available);}catch{/* Keep this session's choice. */}},[]);
 useEffect(()=>{document.documentElement.lang=language==='zh'?'zh-CN':'en';document.title=language==='zh'?'一笔奇境 · 边听边画，新想法不用等':'Wonderline · Keep talking while we draw';},[language]);
 const value=useMemo(()=>({language,setLanguage,t:(source:string,values?:Record<string,string|number>)=>translateUi(language,source,values),brand:BRAND[language]}),[language,setLanguage]);
 return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export function useLanguage(){return useContext(LanguageContext);}
