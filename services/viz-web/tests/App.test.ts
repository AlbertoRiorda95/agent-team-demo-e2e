import { mount } from '@vue/test-utils';
import { expect, test } from 'vitest';
import App from '../src/App.vue';

test('placeholder page shows the title and the skeleton text', () => {
  const wrapper = mount(App);
  expect(wrapper.get('h1').text()).toBe('Trajectory viewer');
  expect(wrapper.text()).toContain('Skeleton: no trajectory yet');
});
