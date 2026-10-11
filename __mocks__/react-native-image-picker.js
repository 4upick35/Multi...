module.exports = {
  launchCamera: jest.fn().mockResolvedValue({didCancel: true, assets: []}),
  launchImageLibrary: jest.fn().mockResolvedValue({didCancel: true, assets: []}),
};
