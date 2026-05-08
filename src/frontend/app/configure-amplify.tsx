'use client';

import { Amplify } from 'aws-amplify';
import amplifyConfig from './amplify-config';

Amplify.configure(amplifyConfig, { ssr: true });

export function ConfigureAmplify() {
  return null;
}