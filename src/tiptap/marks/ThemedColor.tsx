import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    themedColor: {
      /** Apply a theme color token to the current selection */
      setThemeColor: (token: string, fallbackColor?: string | null) => ReturnType;
      /** Remove the theme color token from the current selection */
      unsetThemeColor: () => ReturnType;
    };
  }
}

export const ThemedColor = Mark.create({
  name: 'themedColor',
  group: 'inline',
  spanning: true,
  inclusive: true, // behaves like the Color mark
  priority: 1001, // higher than TextStyle/Color so our data-attr survives normalizations
  excludes: '',

  addAttributes() {
    return {
      token: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-theme-color'),
      },
      fallback: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-theme-color-fallback'),
      },
    };
  },

  parseHTML() {
    // recognize both explicit data-attr and a class hook, if you ever add one
    return [{ tag: 'span[data-theme-color]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = { ...HTMLAttributes };
    const token = attrs.token;
    const fallback = attrs.fallback;
    delete attrs.token;
    delete attrs.fallback;

    if (token) attrs['data-theme-color'] = token;
    if (fallback) {
      attrs['data-theme-color-fallback'] = fallback;
      attrs.style = attrs.style ? `${attrs.style};color:${fallback}` : `color:${fallback}`;
    }

    return ['span', mergeAttributes(attrs), 0];
  },

  addCommands() {
    return {
      setThemeColor:
        (token, fallbackColor) =>
        ({ chain }) =>
          chain()
            .setMark(this.name, { token, fallback: fallbackColor ?? null })
            .run(),
      unsetThemeColor:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name).run(),
    };
  },
});
