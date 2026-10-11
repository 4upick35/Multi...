import {hasCaptchaWidget, isCaptchaRequired} from '../../src/utils/captcha';

describe('isCaptchaRequired', () => {
  it('{siteKey:"x"} → true', () => {
    expect(isCaptchaRequired({siteKey: 'x'})).toBe(true);
  });

  it('{siteKey:""} → false', () => {
    expect(isCaptchaRequired({siteKey: ''})).toBe(false);
  });

  it('{siteKey:"   "} → false', () => {
    expect(isCaptchaRequired({siteKey: '   '})).toBe(false);
  });

  it('{siteKey:null} → false', () => {
    expect(isCaptchaRequired({siteKey: null})).toBe(false);
  });

  it('{} → false', () => {
    expect(isCaptchaRequired({})).toBe(false);
  });

  it('null → false', () => {
    expect(isCaptchaRequired(null)).toBe(false);
  });

  it('undefined → false', () => {
    expect(isCaptchaRequired(undefined)).toBe(false);
  });

  it('{siteKey:"x",secretKey:"y"} → true', () => {
    expect(isCaptchaRequired({siteKey: 'x', secretKey: 'y'})).toBe(true);
  });
});

describe('hasCaptchaWidget', () => {
  it('дескриптор с checkResponseFromCaptcha → true', () => {
    expect(hasCaptchaWidget({checkResponseFromCaptcha: 'recaptcha'})).toBe(true);
  });

  it('дескриптор с site_key → true', () => {
    expect(hasCaptchaWidget({site_key: 'abc'})).toBe(true);
  });

  it('{fields: []} → false', () => {
    expect(hasCaptchaWidget({fields: []})).toBe(false);
  });

  it('обычный текст → false', () => {
    expect(hasCaptchaWidget('обычный текст')).toBe(false);
  });

  it('null → true', () => {
    expect(hasCaptchaWidget(null)).toBe(true);
  });

  it('объект с циклической ссылкой → true', () => {
    const a: any = {};
    a.self = a;
    expect(hasCaptchaWidget(a)).toBe(true);
  });
});
