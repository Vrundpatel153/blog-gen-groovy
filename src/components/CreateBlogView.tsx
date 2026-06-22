import React, { useState } from 'react';
import * as Icons from 'lucide-react';

interface CreateBlogViewProps {
  onGenerate: (promptData: {
    prompt: string;
    blogType: string;
    tone: string;
    audience: string;
    language: string;
    length: string;
    seoKeywords: string;
    preferences: string[];
  }) => void;
  isGenerating?: boolean;
}

export const CreateBlogView: React.FC<CreateBlogViewProps> = ({ onGenerate, isGenerating = false }) => {
  const [prompt, setPrompt] = useState('');
  const [blogType, setBlogType] = useState('Informative Blog');
  const [tone, setTone] = useState('Professional');
  const [audience, setAudience] = useState('General Audience');
  const [language, setLanguage] = useState('English');
  const [length, setLength] = useState('Medium (~1200 words)');
  const [seoKeywords, setSeoKeywords] = useState('');
  const [preferences, setPreferences] = useState<string[]>([
    'faq',
    'takeaways',
    'statistics',
    'cta',
  ]); // All selected by default as in screenshot
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(true);

  const togglePreference = (pref: string) => {
    if (preferences.includes(pref)) {
      setPreferences(preferences.filter((p) => p !== pref));
    } else {
      setPreferences([...preferences, pref]);
    }
  };

  const handleSuggestIdeas = () => {
    setPrompt(
      'Write a blog about the future of AI in business and how automation, smarter decision-making, and generative AI tools are reshaping modern enterprise workflows.'
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    onGenerate({
      prompt,
      blogType,
      tone,
      audience,
      language,
      length,
      seoKeywords,
      preferences,
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-[#0f1115] overflow-y-auto">
      {/* Top Bar */}
      <header className="h-16 flex-shrink-0 flex items-center justify-end px-8 gap-4 bg-transparent">
        <button className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-slate-800 text-slate-300 transition-colors">
          <Icons.Sun className="w-5 h-5 text-slate-300" />
        </button>
        <div className="flex items-center gap-3 cursor-pointer group">
          <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center text-black font-semibold text-sm">
            A
          </div>
          <span className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors">
            Alex Smith
          </span>
          <Icons.ChevronDown className="w-4 h-4 text-slate-400" />
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-4 flex flex-col items-center">
        {/* Header Hero */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center mb-4 text-white">
            <Icons.Sparkles className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-[38px] font-extrabold tracking-tight text-slate-100 leading-tight mb-3">
            Create Amazing Blogs with <span className="text-slate-300">AI</span>
          </h1>
          <p className="text-base text-slate-400 max-w-xl leading-relaxed">
            Describe your topic and let our AI craft a well-structured, SEO-friendly blog in seconds.
          </p>
        </div>

        {/* Input Panel Card */}
        <form
          onSubmit={handleSubmit}
          className="w-full bg-[#171a21] rounded-3xl border border-[#2d3240] shadow-xl shadow-black/30 p-6 flex flex-col gap-6 mb-12"
        >
          {/* Prompt input area */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold text-slate-200">
                What is your blog about?{' '}
                <span className="text-xs font-normal text-slate-400 ml-1.5 cursor-pointer hover:underline">
                  Be specific to get better results
                </span>
              </span>
              <span className="text-slate-500 text-xs">{prompt.length}/500</span>
            </div>

            <div className="relative border-2 border-slate-600 focus-within:border-slate-300 rounded-2xl p-1.5 transition-all">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value.slice(0, 500))}
                placeholder="E.g. Write a blog about the benefits of AI in healthcare for patients and providers..."
                className="w-full h-32 bg-transparent text-slate-100 text-sm placeholder-slate-500 outline-none resize-none px-3 py-2 leading-relaxed"
                maxLength={500}
              />
              <button
                type="button"
                onClick={handleSuggestIdeas}
                className="absolute bottom-3 right-3 flex items-center gap-1.5 py-1.5 px-3 bg-slate-900 border border-slate-700 hover:border-slate-500 hover:bg-slate-800 text-xs font-semibold text-slate-200 rounded-lg shadow-sm transition-all"
              >
                <Icons.Sparkles className="w-3.5 h-3.5" />
                <span>Suggest Ideas</span>
              </button>
            </div>
          </div>

          {/* Form Options Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Blog Type */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1">
                <span>Blog Type</span>
                <Icons.Info className="w-3.5 h-3.5 text-slate-500 cursor-help" />
              </label>
              <div className="relative">
                <select
                  value={blogType}
                  onChange={(e) => setBlogType(e.target.value)}
                  className="w-full pl-3 pr-10 py-2.5 bg-[#0f131b] border border-slate-700 rounded-xl text-sm text-slate-100 outline-none appearance-none cursor-pointer focus:border-slate-400 hover:border-slate-500 transition-colors"
                >
                  <option>Informative Blog</option>
                  <option>SEO Strategy Blog</option>
                  <option>Product Comparison</option>
                  <option>Thought Leadership</option>
                </select>
                <Icons.ChevronsUpDown className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Tone of Voice */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1">
                <span>Tone of Voice</span>
                <Icons.Info className="w-3.5 h-3.5 text-slate-500 cursor-help" />
              </label>
              <div className="relative">
                <select
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  className="w-full pl-3 pr-10 py-2.5 bg-[#0f131b] border border-slate-700 rounded-xl text-sm text-slate-100 outline-none appearance-none cursor-pointer focus:border-slate-400 hover:border-slate-500 transition-colors"
                >
                  <option>Professional</option>
                  <option>Casual</option>
                  <option>Witty / Creative</option>
                  <option>Empathetic</option>
                  <option>Educational</option>
                </select>
                <Icons.ChevronsUpDown className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Audience */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1">
                <span>Audience</span>
                <Icons.Info className="w-3.5 h-3.5 text-slate-500 cursor-help" />
              </label>
              <div className="relative">
                <select
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  className="w-full pl-3 pr-10 py-2.5 bg-[#0f131b] border border-slate-700 rounded-xl text-sm text-slate-100 outline-none appearance-none cursor-pointer focus:border-slate-400 hover:border-slate-500 transition-colors"
                >
                  <option>General Audience</option>
                  <option>Professionals</option>
                  <option>Tech Enthusiasts</option>
                  <option>Students</option>
                </select>
                <Icons.ChevronsUpDown className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Language */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-slate-300">Language</label>
              <div className="relative">
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full pl-3 pr-10 py-2.5 bg-[#0f131b] border border-slate-700 rounded-xl text-sm text-slate-100 outline-none appearance-none cursor-pointer focus:border-slate-400 hover:border-slate-500 transition-colors"
                >
                  <option>English</option>
                  <option>Spanish</option>
                  <option>French</option>
                  <option>German</option>
                  <option>Japanese</option>
                </select>
                <Icons.ChevronsUpDown className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* Length */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-slate-300">Length</label>
              <div className="relative">
                <select
                  value={length}
                  onChange={(e) => setLength(e.target.value)}
                  className="w-full pl-3 pr-10 py-2.5 bg-[#0f131b] border border-slate-700 rounded-xl text-sm text-slate-100 outline-none appearance-none cursor-pointer focus:border-slate-400 hover:border-slate-500 transition-colors"
                >
                  <option>Medium (~1200 words)</option>
                  <option>Short (~600 words)</option>
                  <option>Long (~2000 words)</option>
                </select>
                <Icons.ChevronsUpDown className="w-4 h-4 text-slate-500 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>

            {/* SEO Focus Keywords */}
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-slate-300">
                SEO Focus Keywords <span className="text-slate-500 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={seoKeywords}
                onChange={(e) => setSeoKeywords(e.target.value)}
                placeholder="AI, healthcare, benefits, technology"
                className="w-full px-3 py-2.5 bg-[#0f131b] border border-slate-700 rounded-xl text-sm text-slate-100 outline-none focus:border-slate-400 hover:border-slate-500 transition-colors"
              />
            </div>
          </div>

          {/* Additional Preferences (Accordion) */}
          <div className="border border-[#313847] rounded-2xl bg-[#121722]">
            <button
              type="button"
              onClick={() => setIsPreferencesOpen(!isPreferencesOpen)}
              className="w-full flex items-center justify-between px-4 py-3 text-xs font-bold text-slate-300 bg-[#161c28] hover:bg-slate-800 transition-colors rounded-2xl"
            >
              <span>Additional Preferences <span className="text-slate-500 font-normal">(optional)</span></span>
              {isPreferencesOpen ? (
                <Icons.ChevronUp className="w-4 h-4 text-slate-500" />
              ) : (
                <Icons.ChevronDown className="w-4 h-4 text-slate-500" />
              )}
            </button>

            {isPreferencesOpen && (
              <div className="p-4 flex flex-wrap gap-3">
                {/* FAQ */}
                <button
                  type="button"
                  onClick={() => togglePreference('faq')}
                  className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold border transition-all ${
                    preferences.includes('faq')
                      ? 'bg-slate-800 border-slate-500 text-slate-100'
                      : 'bg-[#0f131b] border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <Icons.HelpCircle className="w-3.5 h-3.5" />
                  <span>Include FAQ Section</span>
                </button>

                {/* Key Takeaways */}
                <button
                  type="button"
                  onClick={() => togglePreference('takeaways')}
                  className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold border transition-all ${
                    preferences.includes('takeaways')
                      ? 'bg-slate-800 border-slate-500 text-slate-100'
                      : 'bg-[#0f131b] border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <Icons.FileText className="w-3.5 h-3.5" />
                  <span>Add Key Takeaways &gt;</span>
                </button>

                {/* Statistics */}
                <button
                  type="button"
                  onClick={() => togglePreference('statistics')}
                  className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold border transition-all ${
                    preferences.includes('statistics')
                      ? 'bg-slate-800 border-slate-500 text-slate-100'
                      : 'bg-[#0f131b] border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <Icons.BarChart2 className="w-3.5 h-3.5" />
                  <span>Include Statistics &gt;</span>
                </button>

                {/* Call to Action */}
                <button
                  type="button"
                  onClick={() => togglePreference('cta')}
                  className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold border transition-all ${
                    preferences.includes('cta')
                      ? 'bg-slate-800 border-slate-500 text-slate-100'
                      : 'bg-[#0f131b] border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <Icons.Zap className="w-3.5 h-3.5" />
                  <span>Add Call to Action &gt;</span>
                </button>
              </div>
            )}
          </div>

          {/* Submit Action */}
          <div className="flex flex-col items-center gap-2 mt-2">
            <button
              type="submit"
              disabled={!prompt.trim() || isGenerating}
              className={`w-full max-w-sm flex items-center justify-center gap-2 py-3 px-6 text-sm font-semibold rounded-xl text-white shadow-lg shadow-black/20 transition-all ${
                prompt.trim() && !isGenerating
                  ? 'bg-white hover:bg-slate-100 text-black cursor-pointer active:scale-[0.98]'
                  : 'bg-slate-700 text-slate-500 cursor-not-allowed shadow-none'
              }`}
            >
              {isGenerating ? (
                <>
                  <Icons.Loader2 className="w-4 h-4 animate-spin" />
                  <span>Generating with AI...</span>
                </>
              ) : (
                <>
                  <Icons.Sparkles className="w-4 h-4" />
                  <span>Generate Blog</span>
                </>
              )}
            </button>
            <span className="text-[10.5px] text-slate-500 font-semibold flex items-center gap-1">
              <Icons.CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 stroke-[2.5px]" />
              <span>{isGenerating ? 'AI is writing your blog...' : 'It only takes a few seconds'}</span>
            </span>
          </div>
        </form>
      </main>
    </div>
  );
};

