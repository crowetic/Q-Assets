import { Mark, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    themedColor: {
      /** Apply a theme color token to the current selection */
      setThemeColor: (token: string) => ReturnType;
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
        renderHTML: (attrs) => (attrs.token ? { 'data-theme-color': attrs.token } : {}),
      },
    };
  },

  parseHTML() {
    // recognize both explicit data-attr and a class hook, if you ever add one
    return [{ tag: 'span[data-theme-color]' }];
  },

  renderHTML({ HTMLAttributes }) {
    // we don’t set style=color here; CSS will map token → color
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setThemeColor:
        (token) =>
        ({ chain }) =>
          chain().setMark(this.name, { token }).run(),
      unsetThemeColor:
        () =>
        ({ chain }) =>
          chain().unsetMark(this.name).run(),
    };
  },
});
