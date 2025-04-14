// String Manipulation
// Tests string operations and regular expressions
(() => {
  const text = "The quick brown fox jumps over the lazy dog 123456789";
  const words = text.split(' ');
  const wordCount = words.length;
  const charCount = text.length;
  const containsNumbers = /\d+/.test(text);
  const uppercased = text.toUpperCase();
  const reversed = text.split('').reverse().join('');
  return { 
    wordCount, 
    charCount, 
    containsNumbers, 
    sample: uppercased.substring(0, 20), 
    reversed: reversed.substring(0, 20) 
  };
})()