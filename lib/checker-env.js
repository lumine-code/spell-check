module.exports = {
  isLinux() {
    return /linux/.test(process.platform);
  },
  isWindows() {
    return /win32/.test(process.platform);
  }, // TODO: Windows < 8 or >= 8
  isDarwin() {
    return /darwin/.test(process.platform);
  },
  preferHunspell() {
    return !!process.env.SPELLCHECKER_PREFER_HUNSPELL;
  },

  // Whether the operating system's own spelling service can check a whole
  // buffer at a time, which is the only way this package uses it.
  //
  // Windows has one, and it is far too slow for the job: `ISpellChecker::Check`
  // costs about 13ms per kilobyte and gets worse as the text grows — 35 seconds
  // for a megabyte, against 52ms for the same buffer through Hunspell, for
  // identical results. Splitting the buffer up does not help; a megabyte in one
  // kilobyte pieces is no faster. The service is fine for one word at a time,
  // which is what it was designed for, so `getCorrectionsForMisspelling` and
  // friends remain usable — whole-buffer checking does not.
  isSystemSupported() {
    return this.isDarwin();
  },
  isLocaleSupported() {
    return true;
  },

  useLocales() {
    return this.isLinux() || this.isWindows() || this.preferHunspell();
  },
};
