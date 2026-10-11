import {extractField} from '../../src/utils/extract-field';

describe('extractField', () => {
  it('извлекает значение по первому совпадающему ключу', () => {
    const obj = {foo: 'hello', bar: 'world'};
    expect(extractField(obj, ['foo', 'bar'])).toBe('hello');
  });

  it('переходит к следующему ключу если первый не найден', () => {
    const obj = {bar: 'world'};
    expect(extractField(obj, ['foo', 'bar'])).toBe('world');
  });

  it('возвращает пустую строку если ничего не найдено', () => {
    const obj = {a: 1};
    expect(extractField(obj, ['x', 'y'])).toBe('');
  });

  it('возвращает пустую строку для пустого объекта', () => {
    expect(extractField({}, ['id', 'Id', '__id'])).toBe('');
  });

  it('пропускает нестроковые значения (number, null, undefined)', () => {
    const obj = {id: 123, Id: null, __id: undefined, ID: 'abc'};
    expect(extractField(obj, ['id', 'Id', '__id', 'ID'])).toBe('abc');
  });

  it('пропускает пустую строку', () => {
    const obj = {a: '', b: 'value'};
    expect(extractField(obj, ['a', 'b'])).toBe('value');
  });

  it('возвращает первое не-пустое значение из вариантов ELMA', () => {
    const obj = {__name: 'Test Name'};
    expect(extractField(obj, ['title', 'Title', 'subject', 'Subject', '__name'])).toBe('Test Name');
  });

  it('возвращает пустую строку если все значения пустые', () => {
    const obj = {a: '', b: '', c: ''};
    expect(extractField(obj, ['a', 'b', 'c'])).toBe('');
  });

  it('возвращает пустую строку для пустого списка ключей', () => {
    expect(extractField({key: 'val'}, [])).toBe('');
  });
});
