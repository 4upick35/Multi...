const React = require('react');

function DateTimePicker(props) {
  return React.createElement('DateTimePicker', props);
}

module.exports = {
  __esModule: true,
  default: DateTimePicker,
  DateTimePickerMode: {
    date: 'date',
    time: 'time',
    datetime: 'datetime',
  },
};
